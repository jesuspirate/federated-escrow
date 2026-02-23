# Federated Escrow — Architecture Reference
## For use as context in the Marketplace project

> This document captures the complete escrow system's API surface, data models,
> authentication flow, and deployment details so that the Marketplace layer can
> build on top of it without re-discovering the escrow internals.

---

## 1. System Overview

The Federated Escrow is a 2-of-3 multisig escrow system for peer-to-peer Bitcoin
trades inside Fedimint communities. Three participants (Seller, Buyer, Arbiter)
vote to release or refund sats. Two agreeing votes resolve the escrow.

**Stack:** React SPA → Express/TypeScript API → SQLite → fedimint-cli → Federation

**Live deployment:** https://satoshimarket.app
**Repository:** https://github.com/jesuspirate/federated-escrow
**VPS:** 1984 Hosting (Iceland), 89.147.108.68, Ubuntu 24.04
**Domain:** Njalla (satoshimarket.app)

---

## 2. Authentication — Nostr NIP-98

Every API request must include a signed NIP-98 Authorization header.

**Frontend flow:**
1. `window.nostr.getPublicKey()` → gets hex pubkey from browser extension (Alby, nos2x)
2. For each API call, `makeNip98Header(url, method)` creates a Nostr kind-27235 event
3. The event is signed via `window.nostr.signEvent(event)`
4. Sent as `Authorization: Nostr <base64-encoded-signed-event>`

**Backend middleware** (`ecash-escrow.ts`):
1. Extracts the Authorization header
2. Decodes and verifies the NIP-98 event signature
3. Checks the event's `u` (URL) and `method` tags match the request
4. Sets `req.pubkey` to the verified hex pubkey
5. In dev mode (`NODE_ENV !== "production"`), accepts `X-Dev-Pubkey` header instead

**Identity format:** All pubkeys stored as 64-char lowercase hex strings.
The frontend converts to npub (bech32) only for display using an inline bech32 encoder.

**Implication for Marketplace:** The marketplace can share the same Nostr identity.
Users authenticated in the marketplace are automatically authenticated for escrow API calls.

---

## 3. API Endpoints

Base URL: `/api/ecash-escrows`

### Create Escrow
```
POST /
Body: { amountMsats: number, description?: string, terms?: string, communityLink?: string }
Auth: Seller's Nostr key
Returns: { id, status: "CREATED", seller: { pubkey, npub }, ... }
```
The creator automatically becomes the Seller.

### Join Escrow
```
POST /:id/join
Body: { role: "buyer" | "arbiter" }
Auth: Joiner's Nostr key
Returns: { id, status, yourRole, participants, allJoined, message }
```
When all 3 join, status transitions to `FUNDED`.
Arbiter joins are gated by the allowlist (403 if not approved).

### Get Lock Invoice
```
GET /:id/invoice
Auth: Seller only
Returns: { invoice: string (BOLT-11), mode: "webln", ... }
  OR:   { invoice: null, mode: "manual", message: "..." } (if fedimint-cli unavailable)
```

### Lock Sats
```
POST /:id/lock
Body: { mode: "webln" } | { mode: "manual", notes: string }
Auth: Seller only
Transitions: FUNDED → LOCKED
```

### Cast Vote
```
POST /:id/approve
Body: { outcome: "release" | "refund" }
Auth: Any participant (with role-based ordering enforced)
```
**Voting order:** Buyer first → Seller second → Arbiter only if disagreement.
If 2 votes agree, status transitions to `APPROVED` and `resolvedOutcome` is set.

### Claim Escrow
```
POST /:id/claim
Auth: Winner (buyer if release, seller if refund)
Transitions: APPROVED → CLAIMED
Returns: { payoutReady: boolean, amountSats, notes? }
```

### Payout
```
POST /:id/payout
Body: { invoice: string (BOLT-11) }
Auth: Winner
Transitions: CLAIMED → COMPLETED
```
The server pays the invoice via `fedimint-cli module ln pay`.

### List Escrows
```
GET /
Auth: Any user
Returns: Array of escrows where the user is a participant
```

### Get Escrow Detail
```
GET /:id
Auth: Any participant
Returns: Full escrow object with participants, votes, status, timestamps
```

### Arbiter Check
```
GET /arbiter-check
Auth: Any user
Returns: { allowed: boolean, mode: "allowlist" | "open" }
```

### Health Check
```
GET /health
No auth required
Returns: { status, escrowCount, fedimintClientd: "connected" | "unavailable", ... }
```

---

## 4. Data Model

### Escrow (SQLite)

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Short unique ID (e.g., "ecash_42") |
| seller_pubkey | TEXT | Creator's hex pubkey |
| buyer_pubkey | TEXT | Buyer's hex pubkey (null until joined) |
| arbiter_pubkey | TEXT | Arbiter's hex pubkey (null until joined) |
| amount_msats | INTEGER | Escrow amount in millisatoshis |
| status | TEXT | CREATED / FUNDED / LOCKED / APPROVED / CLAIMED / COMPLETED / EXPIRED |
| description | TEXT | Freeform trade description |
| terms | TEXT | Trade terms |
| community_link | TEXT | Link to Fedi community |
| federation_id | TEXT | Federation identifier |
| votes | TEXT | JSON: { release: N, refund: N, voters: [...] } |
| resolved_outcome | TEXT | "release" or "refund" (set when 2 votes agree) |
| lock_mode | TEXT | "webln" or "manual" |
| locked_at | TEXT | ISO timestamp of lock |
| created_at | TEXT | ISO timestamp |
| expires_at | TEXT | ISO timestamp (auto-set, currently 24h) |
| encrypted_data | TEXT | AES-256 encrypted blob of sensitive fields |

### Vote Record (within votes JSON)
```json
{
  "release": 1,
  "refund": 1,
  "voters": [
    { "role": "buyer", "outcome": "release", "timestamp": "..." },
    { "role": "seller", "outcome": "refund", "timestamp": "..." }
  ]
}
```

---

## 5. Escrow State Machine

```
CREATED ──(all 3 join)──→ FUNDED ──(seller locks)──→ LOCKED
                                                        │
                                          ┌─────────────┤
                                          ▼             ▼
                                    [votes cast]   [timeout]
                                          │             │
                                          ▼             ▼
                                      APPROVED      EXPIRED
                                          │        (seller reclaim)
                                          ▼
                                       CLAIMED
                                          │
                                          ▼
                                      COMPLETED
```

**Transition rules:**
- CREATED → FUNDED: When seller_pubkey, buyer_pubkey, and arbiter_pubkey are all set
- FUNDED → LOCKED: Seller pays invoice or provides manual e-cash notes
- LOCKED → APPROVED: 2-of-3 votes agree (release or refund)
- LOCKED → EXPIRED: `expires_at` timestamp passed
- APPROVED → CLAIMED: Winner calls POST /:id/claim
- CLAIMED → COMPLETED: Winner submits invoice, server pays out

---

## 6. Fedimint Integration

**Module:** `src/fedimint.ts`

The backend wraps `fedimint-cli` commands via child_process.execFile.

| Function | CLI Command | Purpose |
|----------|-------------|---------|
| `createLockInvoice()` | `fedimint-cli module ln invoice` | Generate BOLT-11 for seller to pay |
| `awaitLockPayment()` | `fedimint-cli await-invoice` | Wait for seller's payment confirmation |
| `payoutToWinner()` | `fedimint-cli module ln pay` | Pay winner's invoice |
| `awaitPayout()` | `fedimint-cli await-ln-pay` | Wait for payout confirmation |
| `checkAvailable()` | `fedimint-cli info` | Test federation connectivity |

**Retry logic:** All FM calls use `fmRetry(3, ...)` with exponential backoff to handle
intermittent federation peer failures (common with fedimint peer P2P transport).

**Federation limits (hardcoded in frontend):**
- Max wallet balance: 10,000,000 sats (10M)
- Max per-transaction: 2,000,000 sats (2M)
- These are enforced client-side in the CreateView amount input

---

## 7. Frontend Architecture

**Single file:** `escrow-ui/src/pages/EcashEscrow.jsx` (~1100 lines)

**Views (state-driven):**
- `list` — ListView: shows all escrows for current user
- `create` — CreateView: new escrow form with amount validation
- `join` — JoinView: enter escrow ID, pick role
- `detail` — DetailView: full escrow status with animated vault, participant nodes, vote tally, action buttons

**Key components:**
- `Vault` — Animated SVG vault visualization (locked/unlocked/burst states)
- `ParticipantNode` — SVG icons with join glow, vote indicators, dispute markers
- `StatusBadge` — Color-coded escrow status pills
- `AnimNum` — Animated sats counter
- `Onboarding` — 3-step splash for first-time users (localStorage gated)

**i18n:** 103 translation keys in EN/FR/ES, stored inline in the component.
Language auto-detected from browser, switchable via flag buttons.

**Dev mode:** URL param `?dev=1` enables identity switcher bar (seller/buyer/arbiter).
Disabled in production (`NODE_ENV=production` blocks `X-Dev-Pubkey` on backend).

---

## 8. Deployment Details

**VPS:** 1984 Hosting, Reykjavik Iceland
**OS:** Ubuntu 24.04 LTS
**Reverse proxy:** Caddy (automatic HTTPS via Let's Encrypt)
**Process manager:** systemd (`fedi-escrow.service`)
**Runtime:** Node.js 20 LTS via tsx (TypeScript execution)

**Service file:** `/etc/systemd/system/fedi-escrow.service`
```
[Service]
Type=simple
User=satoshi
WorkingDirectory=/home/satoshi/federated-escrow
EnvironmentFile=/home/satoshi/federated-escrow/.env
ExecStart=/usr/bin/tsx src/server.ts
Restart=always
```

**Caddy config:** `/etc/caddy/Caddyfile`
```
satoshimarket.app {
    reverse_proxy localhost:3000
}
```

**Security hardening:**
- SSH: Key-only auth (password disabled)
- UFW: Only ports 22, 80, 443 open
- fail2ban: SSH brute-force protection with IP whitelist
- Non-root user `satoshi` runs the service

---

## 9. What the Marketplace Needs to Know

### Escrow as a primitive
The escrow system is a standalone primitive. The Marketplace is a layer on top that:
1. Lets sellers create **listings** (product/service + price + terms)
2. When a buyer wants to purchase, the marketplace calls `POST /api/ecash-escrows/` to create an escrow
3. Both parties + arbiter join via the existing flow
4. The marketplace tracks listing ↔ escrow relationships

### Integration points
- **Create escrow:** `POST /` with `amountMsats`, `description`, `terms`
- **Assign arbiter:** The marketplace could auto-assign an arbiter from the allowlist
- **Track status:** `GET /:id` to poll escrow state
- **Webhooks (future):** Not yet implemented — marketplace would need to poll

### Shared identity
Nostr pubkeys are the universal identity. A user's marketplace profile, escrow participation, and reputation all tie to the same npub.

### Federation scoping
Each escrow is implicitly scoped to a federation (the one the server's fedimint-cli is joined to). Multi-federation support would require multiple fedimint-cli instances or fedimint-clientd with federation switching.

---

## 10. Known Limitations & Future Work

1. **No webhooks** — Clients must poll for status changes
2. **Single federation** — Server is joined to one federation at a time
3. **No federation membership check** — Buyers can join escrows without being in the same federation (Lightning payouts still work, but e-cash note payouts won't)
4. **No dispute evidence** — Arbiter votes blind; no chat/evidence system yet
5. **No reputation** — No trade history or seller/buyer ratings
6. **24h expiry** — Fixed timeout, not configurable per-escrow
7. **SQLite** — Single-writer, sufficient for current scale but not horizontally scalable

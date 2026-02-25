# Federated Escrow — Architecture Reference v9.7
## For use as context in the Marketplace project

> Drop this file into a new Claude Project's knowledge base. It captures the
> complete escrow system's API surface, data models, authentication flow,
> WebLN payment integration, i18n system, and deployment details so that the
> Marketplace layer can build on top of it without re-discovering the internals.
>
> **Last updated:** 2026-02-25 (v9.7)
> **Repository:** https://github.com/jesuspirate/federated-escrow
> **Live:** https://satoshimarket.app

---

## 1. System Overview

The Federated Escrow is a 2-of-3 multisig escrow system for peer-to-peer Bitcoin
trades inside Fedimint federations, deployed as a Fedi Mini-App. Three participants
(Seller, Buyer, Arbiter) vote to release or refund sats. Two agreeing votes resolve
the escrow.

**Stack:** Single-file React SPA → Express/TypeScript API → SQLite → fedimint-cli → Federation

**Deployment:**
- VPS: 1984 Hosting (Iceland), 89.147.108.68, Ubuntu 24.04
- Domain: Njalla (satoshimarket.app)
- SSL: Let's Encrypt via Caddy reverse proxy
- Process: systemd service (`fedi-escrow`)

---

## 2. Project Structure

```
federated-escrow/
├── src/
│   └── ecash-escrow.ts          # Express backend (all routes, DB, fedimint-cli)
├── escrow-ui/
│   ├── src/pages/
│   │   ├── EcashEscrow.jsx      # Entire React frontend (single component)
│   │   ├── i18n.js              # 4-language translations (EN/FR/ES/SW)
│   │   └── index.css            # Global styles + mobile fixes
│   ├── vite.config.js
│   └── package.json
├── dist/                         # Compiled TypeScript output
├── .env                          # Secrets (not in git)
├── .env.example                  # Template with docs
├── .gitignore
├── README.md
├── ARCHITECTURE.md               # This file
└── package.json
```

**Key insight:** The entire frontend is ONE React component (~1,300 lines).
The entire backend is ONE route file. This makes it easy to understand the full system.

---

## 3. Authentication — Nostr NIP-98

Every API request requires a signed NIP-98 Authorization header.

### Frontend Flow
1. `window.nostr.getPublicKey()` → gets hex pubkey (Fedi provides this in WebView)
2. For each API call, `makeNip98Header(url, method)` creates a Nostr kind-27235 event
3. Event is signed via `window.nostr.signEvent(event)`
4. Sent as `Authorization: Nostr <base64-encoded-signed-event>`

### Backend Middleware (ecash-escrow.ts)
1. Extracts the Authorization header
2. Decodes and verifies the NIP-98 event signature
3. Checks the event's `u` (URL) and `method` tags match the request
4. Sets `req.pubkey` to the verified hex pubkey
5. In dev mode (`NODE_ENV !== "production"`), accepts `X-Dev-Pubkey` header

### NIP-98 Retry Logic (v9.5+)
The frontend `api()` wrapper retries up to 2x on 401/403 or Nostr signing rejection.
This handles Fedi's occasional NIP-98 prompt timing issues. Lock/invoice endpoints
use 0 retries to avoid payment prompt spam.

```javascript
async function api(path, opts = {}, _retries = 2) {
  // ... makes NIP-98 header, fetches, retries on 401/403
}
```

### Identity Format
- All pubkeys: 64-char lowercase hex strings
- Frontend converts to npub (bech32) for display only
- Nostr pubkeys are the universal identity across escrow + marketplace

### Implication for Marketplace
Users authenticated in the marketplace are automatically authenticated for escrow
API calls. Same Nostr identity, same NIP-98 flow.

---

## 4. API Endpoints

Base URL: `/api/ecash-escrows`

### List Escrows
```
GET /
Auth: Any Nostr key
Returns: Array of escrow objects the user participates in
```

### Get Escrow Detail
```
GET /:id
Auth: Any Nostr key (must be a participant)
Returns: Full escrow object with participants, votes, status
```

### Create Escrow
```
POST /
Body: { amountMsats: number, description?: string, terms?: string, communityLink?: string }
Auth: Seller's Nostr key (creator becomes seller automatically)
Returns: { id, status: "CREATED", ... }
```

### Join Escrow
```
POST /:id/join
Body: { role: "buyer" | "arbiter" }
Auth: Joiner's Nostr key
Returns: Updated escrow object
Notes: Arbiter role requires pubkey on server's ARBITER_ALLOWLIST
```

### Check Arbiter Eligibility
```
GET /arbiter-check
Auth: Any Nostr key
Returns: { allowed: boolean }
```

### Get Invoice (for WebLN lock)
```
GET /:id/invoice
Auth: Seller's Nostr key
Returns: { mode: "webln", invoice: "<bolt11>" } or { mode: "manual" }
Notes: Generates a Lightning invoice for the escrow amount
```

### Lock Sats
```
POST /:id/lock
Body: { mode: "webln" | "manual", notes?: string }
Auth: Seller's Nostr key
Returns: Updated escrow (status → LOCKED)
Notes: "manual" mode used in sandbox/dev. "webln" mode after WebLN payment.
```

### Vote (Approve outcome)
```
POST /:id/approve
Body: { outcome: "release" | "refund" }
Auth: Participant's Nostr key
Returns: Updated escrow with vote recorded
Notes: 2-of-3 matching votes triggers resolution (status → APPROVED → CLAIMED)
```

### Claim
```
POST /:id/claim
Auth: Winner's Nostr key (buyer for release, seller for refund)
Returns: { status: "CLAIMED", ... }
```

### Payout
```
POST /:id/payout
Body: { invoice: "<bolt11>" }
Auth: Winner's Nostr key
Returns: Payout status
Notes: Pays out via Lightning. Idempotency guards prevent double-pay.
```

---

## 5. State Machine

```
CREATED → FUNDED → LOCKED → APPROVED → CLAIMED → COMPLETED
                                                      ↓
                                                   EXPIRED (24h timeout)
```

| State | Meaning | Who acts next |
|-------|---------|---------------|
| CREATED | Escrow exists, waiting for all 3 participants | Buyer + Arbiter join |
| FUNDED | All 3 joined, invoice generated | Seller locks sats |
| LOCKED | Sats locked in escrow | Buyer votes first, then seller |
| APPROVED | 2-of-3 votes agree | Winner claims |
| CLAIMED | Winner confirmed, payout initiated | System pays out via Lightning |
| COMPLETED | Payout confirmed | Terminal state |
| EXPIRED | 24h timeout reached | Terminal state |

### Vote Resolution Logic
- **Happy path:** Buyer votes "release" + Seller votes "release" → sats go to Buyer
- **Seller dispute:** Buyer votes "release" + Seller votes "refund" → Arbiter breaks tie
- **Arbiter decides:** Arbiter's vote matches one side → that side wins
- Arbiter can only vote after both Buyer and Seller have voted AND they disagree

### 2-Step Confirmation Gates (v9.5+)
Seller and Arbiter get a confirmation dialog before voting. Buyer votes directly.
This prevents accidental votes on irreversible actions.

---

## 6. WebLN Payment Flow (v9.7 — Critical)

The lock payment uses a **2-step decoupled pattern** matching how other Fedi mini-apps
(like ppq.ai) handle WebLN:

### Step 1: Fetch Invoice
```javascript
handleLockFetch() → api(`/${e.id}/invoice`) → NIP-98 auth → returns bolt11
```
- Button: "🔒 Lock X sats"
- Shows "Locking..." while fetching
- Invoice cached in React state (`lockInvoice`)
- Step transitions to "ready"

### Step 2: User-Initiated WebLN Payment
```javascript
handleLockPay() → webln.enable() → webln.sendPayment(lockInvoice)
```
- Button changes to: "⚡ Confirm payment in Fedi"
- Each tap is a fresh user gesture → WebLN works reliably
- On rejection: stays on "ready" step, user can tap again
- On success: calls `POST /:id/lock` to confirm, then refreshes

### Why This Pattern
Fedi's WebLN provider breaks after rejection if `sendPayment()` is called
programmatically in the same flow as NIP-98 auth. Decoupling the invoice fetch
(NIP-98) from the payment (WebLN) ensures retries always work.

### Lock Step States
```
idle → fetching → ready → paying → done
                    ↑        |
                    └────────┘  (on rejection, stays ready)
```

### Dev/Sandbox Mode
When `window.webln` is not present (browser, not Fedi), lock uses manual mode
with synthetic e-cash notes (`ECASH_DEV_{timestamp}`).

---

## 7. Frontend Architecture

### Single Component Design
`EcashEscrow.jsx` contains everything:
- `EcashEscrow` — root component with auth, routing, state
- `OnboardingSplash` — 3-step intro (different for browser vs Fedi)
- `ListView` — escrow list with role tabs (seller/buyer/arbiter)
- `CreateView` — new escrow form
- `JoinView` — role picker → escrow ID → join (order: role first, v9.6+)
- `DetailView` — full escrow lifecycle visualization
- `VaultGraphic` — animated lock/unlock/zap SVG
- `ParticipantNode` — seller/buyer/arbiter status nodes
- `StatusBadge` — colored status pill
- Inline SVG icons (no external icon library)
- Style object `S` at bottom (no CSS modules, no Tailwind)

### Key UI Patterns
- **Action buttons above trade details** (not buried below)
- **Personalized text:** Buyer sees "Release ➜ me", Seller sees "refund to me"
- **Wait banners centered** in tally section and status bar
- **Pulse animation** on claim button when ready
- **Loading spinner** for detail view transitions
- **Stale detail prevention:** state cleared on back, preserved on re-open

### Environment Detection
```javascript
const _isFediApp = typeof window !== "undefined" && !!window.webln;
```
- `true` → Fedi WebView: real NIP-98, real WebLN payments, production mode
- `false` → Browser: sandbox mode, dev pubkeys, manual lock

### Mobile Optimizations (v9.6+)
- `overflow-x: hidden` on html/body/root/container
- No flex/minHeight constraints on container
- Horizontal scroll eliminated (tested Pixel 8)

---

## 8. Internationalization

### System
- File: `escrow-ui/src/pages/i18n.js`
- 4 languages: English, French (Français), Spanish (Español), Swahili (Kiswahili)
- 85+ translation keys per language
- Auto-detection from `navigator.language`, persisted in `localStorage`
- Language picker in header
- Template variables: `t("key", { var: value })` → `"Text {var} more"`

### Adding Keys
```javascript
// i18n.js structure:
const translations = {
  en: { keyName: "English text", ... },
  fr: { keyName: "French text", ... },
  es: { keyName: "Spanish text", ... },
  sw: { keyName: "Swahili text", ... },
};
```

### For Marketplace
Import and extend the same i18n system. The `t()` function falls back: 
`locale → en → key name`. Add marketplace keys to each language block.

---

## 9. Database Schema (SQLite)

### Escrows Table
```sql
CREATE TABLE escrows (
  id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'CREATED',
  amountMsats INTEGER NOT NULL,
  description TEXT,
  terms TEXT,
  communityLink TEXT,
  seller_pubkey TEXT,
  buyer_pubkey TEXT,
  arbiter_pubkey TEXT,
  buyer_outcome TEXT,
  seller_outcome TEXT,
  arbiter_outcome TEXT,
  resolved_outcome TEXT,
  invoice TEXT,
  lock_notes TEXT,
  payout_invoice TEXT,
  payout_status TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);
```

### Key Fields
- `*_outcome`: "release" or "refund" — each participant's vote
- `resolved_outcome`: set when 2-of-3 agree
- `lock_notes`: e-cash notes or "webln" marker
- `payout_status`: tracks Lightning payout state for idempotency

---

## 10. Security

### Arbiter Allowlist
Server-side `ARBITER_ALLOWLIST` env var contains comma-separated hex pubkeys.
Only these pubkeys can join as arbiter. Checked via `GET /arbiter-check`.

### Encryption
`ENCRYPTION_KEY` env var used for encrypting sensitive escrow data at rest.

### Sandbox Isolation
- Browser visitors get synthetic dev pubkeys (no real funds)
- `X-Dev-Pubkey` header only accepted when `NODE_ENV !== "production"`
- Lock/payout endpoints have sandbox bypasses for demo mode

### Environment Variables
```bash
# .env (never committed)
NODE_ENV=production
PORT=3000
ENCRYPTION_KEY=<64-char-hex>
ARBITER_ALLOWLIST=<hex-pubkey1>,<hex-pubkey2>
FEDIMINT_CLIENT_DIR=/path/to/fm-data
```

---

## 11. Deployment

### Service Management
```bash
sudo systemctl restart fedi-escrow    # Restart after backend changes
sudo systemctl status fedi-escrow     # Check status
journalctl -u fedi-escrow -f          # Tail logs
```

### Frontend Build
```bash
cd ~/federated-escrow/escrow-ui
sudo rm -rf dist
npm run build                          # Vite build
sudo systemctl restart fedi-escrow     # Serve new build
```

### Caddy Reverse Proxy
Caddy handles SSL termination and proxies to Express on port 3000.
Static files served from `escrow-ui/dist/`.

---

## 12. Marketplace Integration Points

### How the Marketplace Creates Escrows
1. User lists an item for sale in the marketplace
2. Buyer clicks "Buy" → marketplace calls `POST /api/ecash-escrows/` with amount, description, terms
3. Marketplace stores the `escrow_id` ↔ `listing_id` relationship
4. Both parties + arbiter join via existing flow
5. Marketplace tracks status via `GET /:id`

### API Surface for Marketplace
| Action | Endpoint | Notes |
|--------|----------|-------|
| Create escrow | `POST /` | Marketplace auto-fills amount from listing price |
| Auto-assign arbiter | `POST /:id/join` | Marketplace picks from allowlist |
| Track status | `GET /:id` | Poll for state changes |
| List user's escrows | `GET /` | Filtered by authenticated pubkey |

### Shared Identity
Nostr pubkeys are universal. A user's marketplace profile, escrow participation,
and future reputation system all tie to the same npub.

### Federation Scoping
Each escrow is implicitly scoped to a federation (the one the server's fedimint-cli
is joined to). Multi-federation would require multiple fedimint-cli instances.

### Cross-Federation Limitation
Buyers can join escrows from different federations. Lightning payouts work universally,
but e-cash note payouts become unspendable across federation boundaries.

---

## 13. Known Limitations & Future Work

1. **No webhooks** — Clients must poll for status changes
2. **Single federation** — Server joined to one federation at a time
3. **No federation membership check** — Cross-fed buyers can join but can't spend e-cash payouts
4. **No dispute evidence** — Arbiter votes blind; no chat/evidence system
5. **No reputation** — No trade history or seller/buyer ratings
6. **24h expiry** — Fixed timeout, not configurable per-escrow
7. **SQLite** — Single-writer, sufficient for current scale
8. **No Nostr DM notifications** — Users must check the app manually
9. **No auto-refresh/polling** — Removed in v9.5 for NIP-98 compatibility (each poll triggers auth prompt)

### Marketplace Will Need
- Listing CRUD with categories, search, filtering
- Escrow ↔ Listing relationship table
- Reputation/rating system tied to Nostr pubkeys
- Optional: Nostr DM notifications when escrow status changes
- Optional: Webhooks or SSE for real-time updates (to avoid polling + NIP-98 conflict)
- Optional: Multi-federation support via fedimint-clientd

---

## 14. Version History

| Version | Key Changes |
|---------|-------------|
| v9.0 | Sandbox mode, community-first onboarding, Fedi detection |
| v9.1 | Sandbox auth fix, demo bar, prefilled community links |
| v9.2 | UI polish, Learn More with QR, mobile-responsive demo bar |
| v9.3 | Auto-refresh polling (later removed in v9.5) |
| v9.4 | Full i18n: EN/FR/ES/SW, 85+ keys, auto-detection |
| v9.5 | Vote sync fix, NIP-98 retry, polling removed, layout improvements |
| v9.6 | Mobile scroll fix, horizontal overflow eliminated, join flow reordered |
| v9.7 | **2-step WebLN lock** (critical fix), personalized text, centered wait banners |

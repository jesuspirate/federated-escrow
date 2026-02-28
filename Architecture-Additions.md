## 11. Notification System — NIP-44 Encrypted DMs (Phase 5)

### Why NIP-44 (not NIP-04)

Per Fedi's Mini App Integration Guide:
> "We strongly recommend you use NIP-44 since NIP-04 is NOT considered secure for production usage."

NIP-44 uses ChaCha20 + HMAC-SHA256 with message padding. NIP-04 used AES-256-CBC without authentication. NIP-44 was audited by Cure53 in Dec 2023.

### Architecture

```
State Transition → notifications.ts → nostr-dm.ts → Nostr Relays → User's Client
                   (check prefs)       (NIP-44)       (WebSocket)    (Damus/Amethyst/Fedi)
```

Server holds a dedicated bot keypair (`NOSTR_BOT_PRIVKEY`). Notifications are fire-and-forget — they never block API responses. Failures are logged but swallowed.

### Notification Triggers

| # | Event | Notifies | Category |
|---|-------|----------|----------|
| 1 | Participant joins escrow | Other participants | escrow |
| 2 | Escrow fully funded (3/3) | All participants | escrow |
| 3 | Sats locked | Buyer + arbiter | escrow |
| 4 | Vote cast | Other participants (vote hidden) | escrow |
| 5 | Escrow resolved (2-of-3) | All (winner gets claim CTA) | escrow |
| 6 | Payout complete | Winner | escrow |
| 7 | Listing purchased | Seller + buyer | listing / order |
| 8 | New rating received | Rated user | order |

### API Endpoints

```
GET  /api/notifications/status       — System status (no auth)
GET  /api/notifications/preferences  — User's settings (NIP-98 auth)
POST /api/notifications/preferences  — Update settings (NIP-98 auth)
POST /api/notifications/test         — Send test DM (NIP-98 auth)
```

### Database

```sql
CREATE TABLE notification_preferences (
  pubkey TEXT PRIMARY KEY,
  dm_enabled INTEGER DEFAULT 1,
  escrow_updates INTEGER DEFAULT 1,
  order_updates INTEGER DEFAULT 1,
  listing_sold INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### NIP-44 Implementation

- `nostr-tools/nip44` v2 — already a dependency (nostr-tools@2.23.1)
- `nip44.v2.utils.getConversationKey(sk, pk)` → ECDH + HKDF shared key
- `nip44.v2.encrypt(msg, convKey)` → ChaCha20 + HMAC + padding
- `nostr-tools/pure.finalizeEvent()` → NIP-01 serialization + Schnorr signing
- `ws` package → WebSocket relay publishing

### Security

- Bot privkey never leaves the server process
- NIP-44 encryption per recipient (unique conversation key per pair)
- Messages contain escrow IDs and status only — no amounts or e-cash data
- Dev/sandbox pubkeys (aaa…, bbb…, ccc…) are automatically excluded
- Relay publishing: parallel with 8s timeout, success if ≥1 relay accepts

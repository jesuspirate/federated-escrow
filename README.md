# ⚡ Federated Escrow

**Trustless P2P escrow powered by Fedimint e-cash, Lightning Network, and Nostr identity.**

A 2-of-3 multisig escrow system where a Buyer, Seller, and community Arbiter vote to release or refund sats — no single party can steal funds. Built as a [Fedi Mini-App](https://www.fedi.xyz/) for federated Bitcoin communities.

> **Live:** [satoshimarket.app](https://satoshimarket.app)

---

## How It Works

```
Seller creates escrow → Buyer + Arbiter join → Seller locks sats
    │
    ├─ Happy path: Buyer + Seller agree → sats release to Buyer ✓
    ├─ Dispute:    Buyer + Arbiter agree → sats release to Buyer ✓
    └─ Refund:     Seller + Arbiter agree → sats refund to Seller ↩
```

**No party can act alone.** Two of three participants must agree on the outcome. The Arbiter only votes when Buyer and Seller disagree.

## Features

- **2-of-3 voting** — Trustless escrow resolution without a central authority
- **Fedimint e-cash** — Lock and payout through your federation's Lightning gateway
- **Nostr authentication** — NIP-98 signed requests, no passwords or accounts
- **Arbiter allowlist** — Only pre-approved community members can arbitrate
- **Encrypted at rest** — All escrow data encrypted with AES-256
- **i18n** — English, French, and Spanish
- **WebLN integration** — Seamless payments inside the Fedi app
- **Expiring escrows** — Auto-expire with seller reclaim after timeout
- **Federation limits** — Built-in safeguards for per-transaction and balance limits

## Architecture

```
┌─────────────────────────────────────────────┐
│  Frontend (React SPA)                       │
│  EcashEscrow.jsx — single-file component    │
│  Nostr auth · WebLN payments · i18n         │
├─────────────────────────────────────────────┤
│  Backend (Express + TypeScript)             │
│  NIP-98 middleware · SQLite · AES encryption│
├─────────────────────────────────────────────┤
│  Fedimint Integration                       │
│  fedimint-cli ↔ Federation guardians        │
│  Lightning invoices · e-cash notes          │
└─────────────────────────────────────────────┘
```

## Project Structure

```
federated-escrow/
├── src/
│   ├── server.ts              # Express entry point
│   ├── routes/
│   │   └── ecash-escrow.ts    # All API routes + auth middleware
│   ├── db.ts                  # SQLite schema + prepared statements
│   └── fedimint.ts            # fedimint-cli wrapper with retry logic
├── escrow-ui/
│   └── src/pages/
│       └── EcashEscrow.jsx    # Complete frontend (single file)
├── deploy-vps.sh              # Ubuntu 24.04 hardened deployment script
├── .env.example               # Environment template
└── README.md
```

## Quick Start

### Prerequisites

- Node.js 20+
- `fedimint-cli` (for Lightning lock/payout — optional for dev mode)
- A Nostr browser extension (Alby, nos2x) for authentication

### Development

```bash
git clone https://github.com/jesuspirate/federated-escrow.git
cd federated-escrow

# Install dependencies
npm install
cd escrow-ui && npm install && cd ..

# Configure environment
cp .env.example .env
# Edit .env — generate an encryption key:
#   openssl rand -hex 32

# Start dev server (includes dev mode identity switcher)
npm run dev
```

Open `http://localhost:3000?dev=1` to use the built-in dev identity switcher (Seller / Buyer / Arbiter) without needing a Nostr extension.

### Production Deployment

The included `deploy-vps.sh` handles a full Ubuntu 24.04 deployment:

1. System hardening (UFW, fail2ban, SSH key-only)
2. Node.js 20 LTS installation
3. Caddy reverse proxy with automatic HTTPS
4. systemd service with auto-restart
5. Log rotation

```bash
# On a fresh Ubuntu 24.04 VPS:
scp deploy-vps.sh user@your-server:~
ssh user@your-server
chmod +x deploy-vps.sh && sudo ./deploy-vps.sh
```

## API Reference

All endpoints require NIP-98 authentication (Nostr-signed HTTP requests).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/ecash-escrows/` | Create escrow (seller) |
| `POST` | `/api/ecash-escrows/:id/join` | Join as buyer or arbiter |
| `GET` | `/api/ecash-escrows/:id/invoice` | Get BOLT-11 lock invoice |
| `POST` | `/api/ecash-escrows/:id/lock` | Confirm lock (WebLN or manual) |
| `POST` | `/api/ecash-escrows/:id/approve` | Cast vote (release or refund) |
| `POST` | `/api/ecash-escrows/:id/claim` | Claim resolved escrow |
| `POST` | `/api/ecash-escrows/:id/payout` | Submit invoice for payout |
| `GET` | `/api/ecash-escrows/` | List escrows for current user |
| `GET` | `/api/ecash-escrows/:id` | Get escrow details |
| `GET` | `/api/ecash-escrows/arbiter-check` | Check if current user is approved arbiter |
| `GET` | `/api/ecash-escrows/health` | Server health + federation status |

## Escrow Lifecycle

```
CREATED → FUNDED → LOCKED → APPROVED → CLAIMED → COMPLETED
                                │
                                └→ EXPIRED (seller can reclaim)
```

| Status | Meaning |
|--------|---------|
| `CREATED` | Seller created, waiting for buyer + arbiter |
| `FUNDED` | All 3 participants joined |
| `LOCKED` | Seller paid the escrow invoice — sats are held |
| `APPROVED` | 2-of-3 vote reached consensus |
| `CLAIMED` | Winner initiated claim |
| `COMPLETED` | Payout delivered |
| `EXPIRED` | Timeout reached, seller can reclaim |

## Security

- **NIP-98 authentication** — Every API call is signed by the user's Nostr key
- **Arbiter allowlist** — Hex pubkeys in `ALLOWED_ARBITERS` env var; unauthorized arbiters get 403
- **Encryption at rest** — Escrow data encrypted with AES-256 via `ESCROW_ENCRYPTION_KEY`
- **Dev mode disabled in production** — `X-Dev-Pubkey` header rejected when `NODE_ENV=production`
- **SSH hardening** — deploy script configures key-only auth, fail2ban, UFW

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React (single-file JSX), Tailwind-inspired inline styles |
| Backend | Express, TypeScript, tsx |
| Database | SQLite (better-sqlite3) |
| Payments | Fedimint (fedimint-cli), Lightning Network (WebLN) |
| Identity | Nostr (NIP-98 HTTP auth) |
| Hosting | Ubuntu 24.04, Caddy, systemd |
| Domain | Njalla (privacy-first registrar) |
| VPS | 1984 Hosting (Iceland, privacy-focused) |

## Roadmap

- [ ] Fedi Mini-App manifest + submission
- [ ] Marketplace layer (listings, search, categories)
- [ ] Nostr DM notifications between participants
- [ ] Multi-federation support
- [ ] Reputation system (trade history on Nostr)
- [ ] Mobile-optimized PWA

## Contributing

Contributions welcome. The codebase is intentionally compact — the entire frontend is a single React component, and the backend is a single route file. This makes it easy to understand the full system.

## License

MIT

---

*Built for the federated future. Sats flow, trust is distributed.*

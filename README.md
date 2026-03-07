# SatoshiMarket ⚡🥜

**A Bitcoin-native marketplace, P2P exchange, and community lending platform — powered by Fedimint e-cash and 2-of-3 escrow.**

Built for [Fedi](https://fedi.xyz) communities. No KYC. No middlemen. Just trust-minimized trade.

> ⚡ est. block 934,669

---

## What is SatoshiMarket?

SatoshiMarket is a peer-to-peer marketplace that runs inside Fedi as a Mini-App. Community members can:

- **Buy & sell anything** — electronics, services, digital goods, clothing — with Bitcoin escrow protection
- **Trade sats for fiat** — P2P exchange with support for USD, EUR, CFA, KES, NGN, BRL, ARS, INR and more
- **Lend to your community** — lock sats as loans, with community arbiters verifying repayment (digital tontines!)
- **Resolve disputes** — 2-of-3 multisig voting between buyer, seller, and community arbiter

Every trade is protected by federated e-cash escrow. No trust required.

## How It Works

```
Seller lists item → Buyer accepts → Sats locked in escrow
→ Trade happens externally → Both vote to release → Sats delivered
```

**Three trade types:**

| Type | Flow | Use Case |
|------|------|----------|
| **P2P Sats-for-Fiat** | Seller locks sats → Buyer sends fiat → Both confirm → Buyer gets sats | Exchange Bitcoin without KYC |
| **Marketplace** | Buyer locks sats as payment → Seller ships → Both confirm → Seller gets sats | Buy/sell goods and services |
| **Community Lending** | Lender locks sats → Borrower confirms receipt → Repays externally per terms | Microfinance, tontines, community credit |

If there's a dispute, a pre-approved community arbiter casts the deciding vote.

## Features

### Marketplace
- Create, browse, search, and purchase listings
- Category filters: P2P, Lending, Electronics, Services, Digital, Clothing
- Smart sorting: urgent (1 left) → available → sold out
- Seller management: edit, pause, resume, delete listings
- Auto-activate sold listings when restocked
- Seller profiles with trade stats and ratings

### Escrow
- 2-of-3 voting: buyer + seller + arbiter
- WebLN lock/claim via Fedi wallet
- Buyer votes first → Seller confirms or disputes → Arbiter breaks ties
- Action hints on escrow cards showing what YOU need to do
- Priority sorting: actionable trades first

### Notifications
- Matrix bot posts to community rooms (EN + FR)
- Multilingual: routes to correct room based on listing's community link
- Trade lifecycle: join → lock → resolve notifications
- Sandbox trades excluded from production notifications

### Lending
- Community-backed loans via escrow
- Configurable interest rate, repayment period (7-90 days), repayment method
- Lender locks sats → Borrower receives → Repays externally
- Community arbiter verifies repayment
- Borrower ratings = community credit score

### Security
- NIP-98 Nostr authentication
- Sandbox isolation: dev trades never mix with production
- Arbiter allowlist (pre-approved community members only)
- Federation-scoped trades via community links

### i18n
- English and French
- Language picker in marketplace controls both views
- Notifications post in the correct language per community room

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Node.js / Express / TypeScript (tsx) |
| Frontend | React / Vite (single-page Mini-App) |
| Database | SQLite (better-sqlite3) |
| Payments | Fedimint (e-cash via fedimint-cli) |
| Auth | Nostr (NIP-98 signed events) |
| Notifications | Matrix (community room posts) |
| Proxy | Caddy |
| Process | systemd |
| Platform | Fedi Mini-App (WebView) |

## Architecture

```
┌─────────────────────────────────────────┐
│  Fedi App (WebView)                     │
│  ┌───────────────┐ ┌─────────────────┐  │
│  │  Marketplace  │ │  Escrow Detail  │  │
│  │  (React SPA)  │ │  (React SPA)    │  │
│  └───────┬───────┘ └────────┬────────┘  │
│          │    NIP-98 Auth    │           │
└──────────┼──────────────────┼───────────┘
           │                  │
     ┌─────▼──────────────────▼─────┐
     │  Express API (Node.js/tsx)   │
     │  /api/marketplace/listings   │
     │  /api/ecash-escrows          │
     ├─────────────────────────────-┤
     │  SQLite DB                   │
     │  Fedimint CLI (e-cash)       │
     │  Matrix Bot (notifications)  │
     └─────────────────────────────-┘
```

## Development

### Prerequisites
- Node.js 20+
- Fedimint CLI (for e-cash operations)
- Matrix homeserver access (for notifications)

### Setup
```bash
git clone https://github.com/jesuspirate/federated-escrow.git
cd federated-escrow
npm install
cd escrow-ui && npm install && npm run build && cd ..
```

### Environment (.env)
```
MATRIX_ACCESS_TOKEN=syt_...
MATRIX_HOMESERVER=https://m1.8fa.in
MATRIX_ROOM_ID=!roomId:m1.8fa.in
ALLOWED_ARBITERS=hex_pubkey1,hex_pubkey2
ALLOW_DEV_PUBKEY=true
```

### Run
```bash
npx tsx src/server.ts
```

### Sandbox Mode
Open in any browser — sandbox mode activates automatically (no Fedi required). Switch between seller/buyer/arbiter roles to test the full trade flow.

Visit: [satoshimarket.app](https://satoshimarket.app)

## Live

🌍 **Production:** [satoshimarket.app](https://satoshimarket.app)
📱 **Fedi Mini-App:** Available in Fedi communities with SatoshiMarket enabled
🧪 **Sandbox:** Open the site in any browser to explore

## License

Open source — built for the people, by the people.

⚡ est. block 934,669 🥜

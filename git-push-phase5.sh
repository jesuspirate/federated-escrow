#!/bin/bash
# git-push-phase5.sh — Deploy Phase 5: NIP-44 Nostr DM Notifications
#
# Run from the federated-escrow directory:
#   chmod +x git-push-phase5.sh && ./git-push-phase5.sh

set -e
cd "$(dirname "$0")"

echo "════════════════════════════════════════"
echo " Phase 5: NIP-44 Nostr DM Notifications"
echo "════════════════════════════════════════"
echo ""

# ── Install dependencies ──────────────────────────────────────────────────

echo "📦 Installing dependencies..."
npm install ws @types/ws --save
echo ""

# ── Build frontend ────────────────────────────────────────────────────────

echo "🔨 Building frontend..."
cd escrow-ui
npm install
npm run build
cd ..
echo ""

# ── Git operations ────────────────────────────────────────────────────────

echo "📝 Staging changes..."
git add -A

echo "📋 Changed files:"
git diff --cached --stat

echo ""
echo "🚀 Committing..."
git commit -m "Phase 5: NIP-44 Nostr DM Notifications (v2.1.0)

NEW FILES:
- src/nostr-dm.ts — NIP-44 encrypted DM publishing via Nostr relays
- src/notifications.ts — Notification preferences DB + trigger functions
- src/routes/notifications.ts — REST API for preferences + test DMs
- escrow-ui/src/pages/NotificationSettings.jsx — Settings UI

UPDATED FILES:
- src/server.ts — Mount /api/notifications route
- src/routes/ecash-escrow.ts — Fire-and-forget notification hooks at:
  join, funded, locked, vote, resolved, payout
- src/routes/marketplace.ts — Notification hooks at: purchase, rating
- escrow-ui/src/pages/Marketplace.jsx — Bell icon + notifications view
- package.json — v2.1.0, +ws dependency
- ARCHITECTURE_ADDITIONS.md — Section 11: Notification System

ENCRYPTION:
- Uses NIP-44 (ChaCha20+HMAC) per Fedi's recommendation
- NOT NIP-04 (AES-CBC, deprecated, insecure)
- nostr-tools@2.23.1 nip44.v2 API (already a dependency)

DESIGN:
- Fire-and-forget: notifications never block API responses
- Opt-out: per-user preferences (master toggle + per-category)
- No sensitive data in DMs (IDs and status only)
- Dev/sandbox pubkeys automatically excluded
"

echo ""
echo "⬆️  Pushing to origin..."
git push origin main

echo ""
echo "════════════════════════════════════════"
echo " ✅ Phase 5 deployed!"
echo ""
echo " Post-deploy steps:"
echo "   1. Generate bot keypair:"
echo "      node -e \"const{generateSecretKey,getPublicKey}=require('nostr-tools/pure');const sk=generateSecretKey();console.log('PRIVKEY:',Array.from(sk).map(b=>b.toString(16).padStart(2,'0')).join(''));console.log('PUBKEY:',getPublicKey(sk))\""
echo "   2. Add NOSTR_BOT_PRIVKEY=<hex> to .env"
echo "   3. Restart: sudo systemctl restart fedi-escrow"
echo "   4. Test: curl https://satoshimarket.app/api/notifications/status | jq"
echo "════════════════════════════════════════"

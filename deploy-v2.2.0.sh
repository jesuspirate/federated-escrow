#!/bin/bash
# deploy-v2.2.0.sh — Phase 6: Payment Flow + Rating UX + Sandbox Isolation
# Run on server: bash deploy-v2.2.0.sh

set -e

echo "══════════════════════════════════════════════════"
echo "  Deploying v2.2.0 — Rating Flow + Bug Fixes"
echo "══════════════════════════════════════════════════"

cd /home/satoshi/federated-escrow

# ── Backup ──────────────────────────────────────────
echo ""
echo "📦 Backing up current files..."
mkdir -p backups/pre-v2.2.0
cp src/routes/marketplace.ts backups/pre-v2.2.0/
cp escrow-ui/src/pages/Marketplace.jsx backups/pre-v2.2.0/
cp escrow-ui/src/pages/EcashEscrow.jsx backups/pre-v2.2.0/
cp package.json backups/pre-v2.2.0/
echo "  ✅ Backed up to backups/pre-v2.2.0/"

# ── Copy new files ──────────────────────────────────
# (Assume files have been uploaded/copied to the server already)
# If deploying from local, scp the 3 files first:
#   scp marketplace.ts satoshi@server:~/federated-escrow/src/routes/
#   scp Marketplace.jsx satoshi@server:~/federated-escrow/escrow-ui/src/pages/
#   scp EcashEscrow.jsx satoshi@server:~/federated-escrow/escrow-ui/src/pages/

echo ""
echo "📝 Verifying files exist..."
for f in src/routes/marketplace.ts escrow-ui/src/pages/Marketplace.jsx escrow-ui/src/pages/EcashEscrow.jsx; do
  if [ ! -f "$f" ]; then
    echo "  ❌ Missing: $f"
    echo "  Copy the updated files before running this script."
    exit 1
  fi
  echo "  ✅ $f"
done

# ── Version bump ────────────────────────────────────
echo ""
echo "🔖 Bumping version to 2.2.0..."
sed -i 's/"version": "2.1.0"/"version": "2.2.0"/' package.json
grep '"version"' package.json

# ── Restart service ─────────────────────────────────
echo ""
echo "🔄 Restarting fedi-escrow..."
sudo systemctl restart fedi-escrow
sleep 2

# ── Verify ──────────────────────────────────────────
echo ""
echo "🔍 Checking service status..."
if systemctl is-active --quiet fedi-escrow; then
  echo "  ✅ Service is running"
else
  echo "  ❌ Service failed! Check logs:"
  echo "  journalctl -u fedi-escrow -n 30 --no-pager"
  exit 1
fi

echo ""
echo "📋 Last 15 log lines:"
journalctl -u fedi-escrow -n 15 --no-pager

# ── Git commit ──────────────────────────────────────
echo ""
echo "🔖 Git commit..."
git add -A
git commit -m "v2.2.0 — Rating flow fix + sandbox isolation + community link required

Fixes:
- Both trade parties can now rate each other (UNIQUE constraint fix)
- Rating prompt shows immediately after trade completion (not buried)
- Claim retry no longer errors with 'cannot claim in CLAIMED state'
- Buy action navigates directly to order detail (not back to browse)
- Community link required on listing creation (prevents orphan listings)
- Community link auto-populated in create form
- Sandbox pubkeys filtered from production browse
- arbiterPubkey included in buy response

Files changed:
- src/routes/marketplace.ts
- escrow-ui/src/pages/Marketplace.jsx
- escrow-ui/src/pages/EcashEscrow.jsx
- package.json (2.1.0 → 2.2.0)"

git tag v2.2.0

echo ""
echo "══════════════════════════════════════════════════"
echo "  ✅ v2.2.0 deployed successfully!"
echo ""
echo "  Check for migration log:"
echo "    journalctl -u fedi-escrow | grep 'Migrating ratings'"
echo ""
echo "  Push to remote:"
echo "    git push origin main --tags"
echo "══════════════════════════════════════════════════"

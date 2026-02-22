#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# deploy.sh — Production Deployment for Fedi Escrow
# Sets up: Caddy (HTTPS), systemd service, Fedi Mod config
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────
# Change these before running!
DOMAIN="${DOMAIN:-escrow.yourdomain.com}"
APP_PORT="${APP_PORT:-3000}"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_USER="${USER}"
NODE_BIN="$(which node 2>/dev/null || echo '/usr/bin/node')"

echo "═══════════════════════════════════════════════"
echo "  Fedi Escrow — Production Deployment"
echo "═══════════════════════════════════════════════"
echo "  Domain:   ${DOMAIN}"
echo "  App port: ${APP_PORT}"
echo "  App dir:  ${APP_DIR}"
echo "  User:     ${APP_USER}"
echo "═══════════════════════════════════════════════"
echo ""

# ── Step 1: Install Caddy ────────────────────────────────────────────
echo "→ Step 1: Installing Caddy..."
if command -v caddy &>/dev/null; then
    echo "  Caddy already installed: $(caddy version)"
else
    sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
    sudo apt update
    sudo apt install -y caddy
    echo "  Caddy installed: $(caddy version)"
fi
echo ""

# ── Step 2: Configure Caddy ──────────────────────────────────────────
echo "→ Step 2: Configuring Caddy reverse proxy..."

# Create log directory
sudo mkdir -p /var/log/caddy

# Generate Caddyfile from template
CADDYFILE_CONTENT="${DOMAIN} {
    reverse_proxy localhost:${APP_PORT} {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options SAMEORIGIN
        X-XSS-Protection \"1; mode=block\"
        Referrer-Policy strict-origin-when-cross-origin
        -Server
    }

    encode zstd gzip

    log {
        output file /var/log/caddy/escrow-access.log
        format json
    }
}"

echo "${CADDYFILE_CONTENT}" | sudo tee /etc/caddy/Caddyfile > /dev/null
echo "  Caddyfile written to /etc/caddy/Caddyfile"

# Validate config
sudo caddy validate --config /etc/caddy/Caddyfile 2>/dev/null && echo "  Config validated ✓" || echo "  ⚠ Config validation failed — check /etc/caddy/Caddyfile"

# Reload Caddy
sudo systemctl enable caddy
sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy
echo "  Caddy reloaded ✓"
echo ""

# ── Step 3: Create systemd service for the Express app ───────────────
echo "→ Step 3: Setting up systemd service for escrow app..."

SERVICE_FILE="[Unit]
Description=Fedi Escrow Express Server
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=$(which npx) tsx src/server.ts
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=fedi-escrow

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${APP_DIR}/data ${APP_DIR}

[Install]
WantedBy=multi-user.target"

echo "${SERVICE_FILE}" | sudo tee /etc/systemd/system/fedi-escrow.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable fedi-escrow
echo "  Service created: fedi-escrow.service ✓"
echo ""

# ── Step 4: Open firewall ports ──────────────────────────────────────
echo "→ Step 4: Configuring firewall..."
if command -v ufw &>/dev/null; then
    sudo ufw allow 80/tcp  2>/dev/null || true
    sudo ufw allow 443/tcp 2>/dev/null || true
    echo "  Ports 80 and 443 opened ✓"
else
    echo "  ufw not found — ensure ports 80 and 443 are open"
fi
echo ""

# ── Step 5: Build the frontend ───────────────────────────────────────
echo "→ Step 5: Building frontend..."
cd "${APP_DIR}"
if [ -d "escrow-ui" ]; then
    cd escrow-ui
    npm install --production=false 2>/dev/null || npm install
    npm run build 2>/dev/null && echo "  Frontend built ✓" || echo "  ⚠ Frontend build failed — check escrow-ui/"
    cd "${APP_DIR}"
else
    echo "  No escrow-ui directory found — skipping frontend build"
fi
echo ""

# ── Step 6: Start the app ────────────────────────────────────────────
echo "→ Step 6: Starting escrow service..."
sudo systemctl restart fedi-escrow
sleep 2

if systemctl is-active --quiet fedi-escrow; then
    echo "  fedi-escrow service is running ✓"
else
    echo "  ⚠ Service failed to start. Check: sudo journalctl -u fedi-escrow -f"
fi
echo ""

# ── Done ─────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════"
echo "  Deployment complete!"
echo ""
echo "  Your escrow app should now be live at:"
echo "    https://${DOMAIN}"
echo ""
echo "  Useful commands:"
echo "    sudo journalctl -u fedi-escrow -f     # App logs"
echo "    sudo journalctl -u caddy -f           # Caddy logs"
echo "    sudo systemctl restart fedi-escrow     # Restart app"
echo "    sudo systemctl reload caddy            # Reload Caddy"
echo ""
echo "  Fedi Mod registration:"
echo "    Add this to your federation's 'sites' meta config:"
echo ""
echo '    {'
echo "      \"id\": \"escrow\","
echo "      \"title\": \"P2P Escrow\","
echo "      \"url\": \"https://${DOMAIN}\","
echo "      \"description\": \"Trustless P2P trades with 2-of-3 e-cash escrow\""
echo '    }'
echo ""
echo "═══════════════════════════════════════════════"

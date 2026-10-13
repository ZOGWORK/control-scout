#!/bin/bash
# Control Scout — install / update on the Oracle VM next to Control Point.
#
# Touches ONLY Control Scout: user `controlscout`, /opt/control-scout, the
# systemd unit `control-scout`, and the nginx site `control-scout`. Control
# Point's files, .env, database, service and nginx site are never read or
# changed. Safe to re-run (idempotent).
#
# Run on the VM (after deploy/deploy.sh has copied the code to $APP_DIR):
#   sudo DOMAIN=scout.tryctrlpoint.org CERTBOT_EMAIL=you@example.com bash /opt/control-scout/deploy/oracle-vm-setup.sh
#
#   DOMAIN          nginx server_name (needs a DNS A record → this VM first)
#   CERTBOT_EMAIL   when set, requests a Let's Encrypt certificate for $DOMAIN
#   APP_PORT        internal port (default 3100; Control Point uses 3000)
set -euo pipefail

APP_DIR="/opt/control-scout"
APP_USER="controlscout"
APP_PORT="${APP_PORT:-3100}"
DOMAIN="${DOMAIN:-scout.tryctrlpoint.org}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
SITE_CONF="/etc/nginx/sites-available/control-scout"
UNIT="/etc/systemd/system/control-scout.service"

[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }
[ -f "$APP_DIR/package.json" ] || { echo "No app in $APP_DIR — run deploy/deploy.sh from your machine first"; exit 1; }

# Node 22+ (Control Point already installed a Node; only install if missing/old).
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
command -v nginx >/dev/null || apt-get install -y nginx

id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR/.data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# .env: created once with placeholders; never overwritten (secrets live only here).
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
PORT=$APP_PORT
APP_URL=https://$DOMAIN
DATABASE_URL=file:$APP_DIR/.data/scout.db
FTC_EVENTS_USERNAME=
FTC_EVENTS_TOKEN=
RESEND_API_KEY=
EMAIL_FROM="Control Scout <verify@tryctrlpoint.org>"
EOF
  chmod 600 "$APP_DIR/.env"; chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  echo ">>> Fill in $APP_DIR/.env (FIRST + Resend keys), then re-run this script."
fi

cd "$APP_DIR"
sudo -u "$APP_USER" HOME="$APP_DIR" npm ci --no-audit --no-fund --loglevel=error
sudo -u "$APP_USER" HOME="$APP_DIR" npm run build

cat > "$UNIT" <<EOF
[Unit]
Description=FTC Control Scout
After=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=$(command -v npx) tsx server/index.ts
Restart=always
RestartSec=5
# Hardening: the app only needs its own directory.
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$APP_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable control-scout >/dev/null
systemctl restart control-scout

cat > "$SITE_CONF" <<EOF
server {
  listen 80;
  server_name $DOMAIN;
  client_max_body_size 4m;
  location /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / {
    proxy_pass http://127.0.0.1:$APP_PORT;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF
ln -sf "$SITE_CONF" /etc/nginx/sites-enabled/control-scout
nginx -t && systemctl reload nginx

if [ -n "$CERTBOT_EMAIL" ]; then
  command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" -m "$CERTBOT_EMAIL" --agree-tos --non-interactive --redirect
fi

sleep 8
curl -fsS "http://127.0.0.1:$APP_PORT/api/health" && echo && echo "Control Scout is up on :$APP_PORT ($DOMAIN)"

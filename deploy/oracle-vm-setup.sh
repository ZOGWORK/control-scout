#!/bin/bash
# Control Scout — install / update on the Oracle VM next to Control Point.
#
# Touches ONLY Control Scout: user `controlscout`, /opt/control-scout, the
# systemd unit `control-scout`, and the nginx site `control-scout`. Control
# Point's files, .env, database, service and nginx site are never read or
# changed. Safe to re-run (idempotent).
#
# Normally run by deploy/deploy.sh, which uploads a release first. Layout:
#
#   /opt/control-scout/                 root-owned
#     releases/<sha>/                   one build per deploy (root-owned once built)
#     current -> releases/<sha>         switched atomically after a build succeeds
#     shared/.env                       secrets (root:controlscout 640, never overwritten)
#     shared/data/                      SQLite + packs — the ONLY path the app can write
#
#   RELEASE         release directory name under releases/ (required)
#   DOMAIN          nginx server_name (needs a DNS A record → this VM first)
#   CERTBOT_EMAIL   first certificate only; later runs re-apply the existing one
#   APP_PORT        internal port for a fresh install (default 3100; Control
#                   Point uses 3000). Afterwards the PORT saved in shared/.env wins.
set -euo pipefail

APP_DIR="/opt/control-scout"
APP_USER="controlscout"
RELEASE="${RELEASE:?set RELEASE=<release dir under $APP_DIR/releases>}"
REL_DIR="$APP_DIR/releases/$RELEASE"
SHARED="$APP_DIR/shared"
DOMAIN="${DOMAIN:-scout.tryctrlpoint.org}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
SITE_CONF="/etc/nginx/sites-available/control-scout"
UNIT="/etc/systemd/system/control-scout.service"

[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }
[ -f "$REL_DIR/package.json" ] || { echo "No release at $REL_DIR — run deploy/deploy.sh from your machine"; exit 1; }

# Node 22+ (Control Point already installed a Node; only install if missing/old).
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
command -v nginx >/dev/null || apt-get install -y nginx

id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$SHARED/data" --shell /usr/sbin/nologin "$APP_USER"

# Root owns everything except the data directory, so the app account can never
# change code or this installer (which runs as root).
install -d -o root -g root -m 755 "$APP_DIR" "$APP_DIR/releases" "$SHARED"
install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$SHARED/data"

# shared/.env: created once with placeholders; never overwritten (secrets live only here).
if [ ! -f "$SHARED/.env" ]; then
  cat > "$SHARED/.env" <<EOF
NODE_ENV=production
PORT=${APP_PORT:-3100}
APP_URL=https://$DOMAIN
DATA_DIR=$SHARED/data
DATABASE_URL=file:$SHARED/data/scout.db
FTC_EVENTS_USERNAME=
FTC_EVENTS_TOKEN=
RESEND_API_KEY=
EMAIL_FROM="Control Scout <verify@tryctrlpoint.org>"
EOF
  chown root:"$APP_USER" "$SHARED/.env"; chmod 640 "$SHARED/.env"
  echo ">>> Created $SHARED/.env. Fill in the FIRST + Resend keys, then run deploy/deploy.sh again."
  echo ">>> Nothing was started."
  exit 0
fi
# The saved port wins over APP_PORT, so updates keep a custom port.
APP_PORT="$(sed -n 's/^PORT=//p' "$SHARED/.env" | tail -n1)"
APP_PORT="${APP_PORT:-3100}"

# Build the release as the unprivileged app user (dependency install scripts
# never run as root), then hand it to root so the running app can't modify it.
ln -sfn "$SHARED/.env" "$REL_DIR/.env"
ln -sfn "$SHARED/data" "$REL_DIR/.data"
chown -R "$APP_USER:$APP_USER" "$REL_DIR"
sudo -u "$APP_USER" HOME="$SHARED/data" bash -c "cd '$REL_DIR' && npm ci --no-audit --no-fund --loglevel=error && npm run build"
chown -R root:root "$REL_DIR"
chmod 755 "$REL_DIR"   # readable (not writable) by the app user
chown -h root:root "$REL_DIR/.env" "$REL_DIR/.data"

cat > "$UNIT" <<EOF
[Unit]
Description=FTC Control Scout
After=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/current
EnvironmentFile=$SHARED/.env
ExecStart=$(command -v npx) tsx server/index.ts
Restart=always
RestartSec=5
# Hardening: the app may write only its data directory.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$SHARED/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable control-scout >/dev/null

# Switch to the new build only now that it succeeded (atomic rename), then restart.
ln -sfn "releases/$RELEASE" "$APP_DIR/current.new"
mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"
systemctl restart control-scout

# Keep the three newest releases for rollback.
ls -1dt "$APP_DIR"/releases/*/ | tail -n +4 | while read -r old; do
  [ "$(readlink -f "$old")" = "$(readlink -f "$APP_DIR/current")" ] || rm -rf -- "$old"
done

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
nginx -t

# HTTPS: re-apply an existing certificate on every update (no email needed);
# request one only on the first run with CERTBOT_EMAIL.
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot install --nginx --cert-name "$DOMAIN" -d "$DOMAIN" --redirect --non-interactive
elif [ -n "$CERTBOT_EMAIL" ]; then
  command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" -m "$CERTBOT_EMAIL" --agree-tos --non-interactive --redirect
else
  systemctl reload nginx
  echo ">>> HTTP only: re-run with CERTBOT_EMAIL=… once DNS points here."
fi

sleep 8
curl -fsS "http://127.0.0.1:$APP_PORT/api/health" && echo && echo "Control Scout $RELEASE is up on :$APP_PORT ($DOMAIN)"

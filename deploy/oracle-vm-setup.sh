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
#   DOMAIN          primary domain: APP_URL, certificate name (needs a DNS A record → this VM)
#   EXTRA_DOMAINS   space-separated aliases served by the same site and certificate
#   CERTBOT_EMAIL   only if this VM has no Let's Encrypt account yet
#   APP_PORT        internal port for a fresh install (default 3100; Control
#                   Point uses 3000). Afterwards the PORT saved in shared/.env wins.
set -euo pipefail

APP_DIR="/opt/control-scout"
APP_USER="controlscout"
RELEASE="${RELEASE:?set RELEASE=<release dir under $APP_DIR/releases>}"
REL_DIR="$APP_DIR/releases/$RELEASE"
SHARED="$APP_DIR/shared"
DOMAIN="${DOMAIN:-scout.tryctrlpoint.org}"
EXTRA_DOMAINS="${EXTRA_DOMAINS:-}"
ALL_DOMAINS="$DOMAIN $EXTRA_DOMAINS"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
SITE_CONF="/etc/nginx/sites-available/control-scout"
UNIT="/etc/systemd/system/control-scout.service"
SOCKET_UNIT="/etc/systemd/system/control-scout.socket"

[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }
[ -f "$REL_DIR/package.json" ] || { echo "No release at $REL_DIR — run deploy/deploy.sh from your machine"; exit 1; }

# One install at a time, whether it came from deploy/deploy.sh or the auto-deploy
# updater: both end up here before touching current, the unit or nginx.
exec 8> /run/control-scout-install.lock
flock 8

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
DATA_CYCLE=child
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

# The port belongs to a systemd socket, not to the server: systemd keeps it open
# through every restart and hands it to each new server (server/listen.ts), so
# requests during a deploy wait a few seconds in its queue instead of getting
# nginx's 502. Loopback only: nginx is the one client.
SOCKET_NEW="[Unit]
Description=FTC Control Scout port (kept open across restarts)

[Socket]
ListenStream=127.0.0.1:$APP_PORT
Backlog=4096
NoDelay=true

[Install]
WantedBy=sockets.target"
SOCKET_CHANGED=0
[ "$(cat "$SOCKET_UNIT" 2>/dev/null)" = "$SOCKET_NEW" ] || { printf '%s\n' "$SOCKET_NEW" > "$SOCKET_UNIT"; SOCKET_CHANGED=1; }

# node --import tsx, not npx tsx: npx would start node as a separate child
# process, which doesn't receive the socket.
cat > "$UNIT" <<EOF
[Unit]
Description=FTC Control Scout
After=network-online.target control-scout.socket
Requires=control-scout.socket

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/current
EnvironmentFile=$SHARED/.env
ExecStart=$(command -v node) --import tsx server/index.ts
Restart=always
RestartSec=5
# On stop, the server finishes the requests in progress (up to 10 s) before exiting.
TimeoutStopSec=30
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
systemctl enable control-scout control-scout.socket >/dev/null
# The socket can only take the port once nothing else holds it: the first time
# (the server used to open the port itself) or when PORT changed, stop the
# server first. That one switch has a short gap; every restart after it has none.
if [ "$SOCKET_CHANGED" = 1 ] || ! systemctl is-active --quiet control-scout.socket; then
  systemctl stop control-scout || true
  systemctl restart control-scout.socket
fi

# Switch to the new build only now that it succeeded (atomic rename), then restart.
ln -sfn "releases/$RELEASE" "$APP_DIR/current.new"
mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"
systemctl restart control-scout

# Auto-deploy (deploy/vm-update.sh): published only now that this release built
# and went live, so a failed build never changes the saved domains or the updater.
printf 'DOMAIN=%q\nEXTRA_DOMAINS=%q\n' "$DOMAIN" "$EXTRA_DOMAINS" > "$SHARED/deploy.conf"
chmod 644 "$SHARED/deploy.conf"
install -d -o root -g root -m 755 "$APP_DIR/bin"
install -o root -g root -m 755 "$REL_DIR/deploy/vm-update.sh" "$APP_DIR/bin/update"

# Keep the three newest releases for rollback.
ls -1dt "$APP_DIR"/releases/*/ | tail -n +4 | while read -r old; do
  [ "$(readlink -f "$old")" = "$(readlink -f "$APP_DIR/current")" ] || rm -rf -- "$old"
done

# Keep the working site so a certificate failure can put it back.
[ -f "$SITE_CONF" ] && cp -p "$SITE_CONF" "$SITE_CONF.last-good"
cat > "$SITE_CONF" <<EOF
server {
  listen 80;
  server_name $ALL_DOMAINS;
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

# HTTPS: one certificate (named after DOMAIN) for every domain. Kept while
# valid, expanded when a domain is added, re-applied to nginx on every update.
# Uses the VM's existing Let's Encrypt account (Control Point made one);
# CERTBOT_EMAIL is only needed on a VM without one.
command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx
D_ARGS=""; for d in $ALL_DOMAINS; do D_ARGS="$D_ARGS -d $d"; done
ACCOUNT=$([ -n "$CERTBOT_EMAIL" ] && echo "-m $CERTBOT_EMAIL" || echo "")
# shellcheck disable=SC2086
if certbot --nginx --cert-name "$DOMAIN" $D_ARGS $ACCOUNT --agree-tos --non-interactive --redirect --keep-until-expiring --expand; then
  rm -f "$SITE_CONF.last-good"
elif [ -f "$SITE_CONF.last-good" ]; then
  # An update never drops HTTPS: restore the previous (working) site and fail.
  mv -f "$SITE_CONF.last-good" "$SITE_CONF"
  nginx -t && systemctl reload nginx
  echo ">>> HTTPS failed (see above; DNS for every domain must point here). Restored the previous nginx site; deploy FAILED."
  exit 1
else
  systemctl reload nginx   # first install: HTTP until the certificate can be issued
  echo ">>> HTTPS failed on first install (see above; DNS for every domain must point here). Serving HTTP only."
fi

# The server takes the socket once its data is ready, so this waits for it.
curl -fsS --max-time 120 "http://127.0.0.1:$APP_PORT/api/health" && echo && echo "Control Scout $RELEASE is up on :$APP_PORT ($DOMAIN)"

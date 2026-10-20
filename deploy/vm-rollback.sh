#!/bin/bash
# Roll the Oracle VM back (or forward) to another installed release. Installed
# by oracle-vm-setup.sh as /opt/control-scout/bin/rollback:
#
#   sudo /opt/control-scout/bin/rollback            # lists the installed releases
#   sudo /opt/control-scout/bin/rollback <release>  # a directory name under releases/
#
# Releases from before socket activation (no server/listen.ts) open the port
# themselves, so for one of those this puts back the service they were
# installed with and stops the socket; otherwise the port would already be
# taken and the server couldn't start. The next normal deploy (oracle-vm-setup.sh)
# switches back to socket activation.
set -euo pipefail

APP_DIR=/opt/control-scout
SHARED="$APP_DIR/shared"
UNIT=/etc/systemd/system/control-scout.service
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "Installed releases (newest first; current is $(readlink "$APP_DIR/current")):"
  ls -1t "$APP_DIR/releases"
  exit 0
fi
[[ "$TARGET" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Not a release name: $TARGET"; exit 2; }
REL_DIR="$APP_DIR/releases/$TARGET"

exec 8> /run/control-scout-install.lock
flock 8   # never alongside a deploy (which may also delete old releases)
# Checked only now, under the lock: a deploy that held it may have removed this release.
[ -f "$REL_DIR/package.json" ] || { echo "No release at $REL_DIR"; exit 1; }

# The service as the release expects it: socket-activated (it has server/listen.ts:
# node --import tsx, tied to control-scout.socket) or, before that, opening the
# port itself (npx tsx, no socket). Rewritten both ways, so switching back and
# forth between old and new releases always leaves a service that fits.
if [ -f "$REL_DIR/server/listen.ts" ]; then
  # GNU sed: \n in the replacement adds the Requires= line right after After=.
  sed -i -e 's#^ExecStart=.*#ExecStart='"$(command -v node)"' --import tsx server/index.ts#' \
         -e '/^Requires=control-scout.socket$/d' \
         -e 's#^After=.*#After=network-online.target control-scout.socket\nRequires=control-scout.socket#' "$UNIT"
  systemctl daemon-reload
  if systemctl is-active --quiet control-scout.socket; then
    ln -sfn "releases/$TARGET" "$APP_DIR/current.new"
    mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"
    systemctl restart control-scout
  else
    # Coming from a pre-socket release: its server holds the port, so stop it before the socket takes it.
    systemctl stop control-scout || true
    systemctl enable --now control-scout.socket
    ln -sfn "releases/$TARGET" "$APP_DIR/current.new"
    mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"
    systemctl start control-scout
  fi
else
  sed -i -e 's#^ExecStart=.*#ExecStart='"$(command -v npx)"' tsx server/index.ts#' \
         -e '/^Requires=control-scout.socket$/d' \
         -e 's#^After=.*#After=network-online.target#' "$UNIT"
  systemctl daemon-reload
  systemctl stop control-scout || true
  systemctl disable --now control-scout.socket >/dev/null 2>&1 || true
  ln -sfn "releases/$TARGET" "$APP_DIR/current.new"
  mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"
  systemctl start control-scout
fi

# The Discord bot (control-scout-bot) runs from current too: restart it on the release it now points at,
# or stop it if that release predates the bot (or there's no token). Never fails the rollback.
if [ -f "$REL_DIR/bot/index.ts" ] && grep -Eq '^DISCORD_BOT_TOKEN=.+' "$SHARED/.env" && [ -f /etc/systemd/system/control-scout-bot.service ]; then
  systemctl restart control-scout-bot || echo ">>> bot: failed to restart (journalctl -u control-scout-bot)"
else
  systemctl stop control-scout-bot >/dev/null 2>&1 || true
fi

PORT="$(sed -n 's/^PORT=//p' "$SHARED/.env" | tail -n1)"
for _ in $(seq 1 60); do
  curl -fsS --max-time 5 "http://127.0.0.1:${PORT:-3100}/api/health" 2>/dev/null | grep -q '"ready":true' && { echo "Rolled back to $TARGET; it's up on :${PORT:-3100}"; exit 0; }
  sleep 2
done
echo "Switched to $TARGET, but it isn't answering yet: journalctl -u control-scout -n 50"; exit 1

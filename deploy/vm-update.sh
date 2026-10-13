#!/bin/bash
# Auto-deploy one commit of main on the Oracle VM. Installed by oracle-vm-setup.sh
# as /opt/control-scout/bin/update and run as root by the command queue
# (sushilm20/control-point-commands → /opt/bruno-commands/poller.py), which the
# GitHub workflow .github/workflows/deploy.yml feeds on every push to main:
#
#   sudo /opt/control-scout/bin/update <40-hex commit sha>
#
# Returns at once and builds in the background (the poller gives a command two
# minutes); progress goes to /var/log/control-scout-deploy.log, and the workflow
# waits for /api/health to report the new release. Deploys run one at a time.
#
# Fetches with credentials that live only on this VM (a read-only token in
# /opt/control-scout/github_token, or a read-only deploy key), refuses any
# commit that isn't on main, then
# installs it exactly like deploy/deploy.sh does: new release beside the live
# one, switched only after the build succeeds.
set -euo pipefail

APP_DIR=/opt/control-scout
LOG=/var/log/control-scout-deploy.log
SHA="${1:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "usage: update <40-hex commit sha>"; exit 2; }
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }

if [ "${2:-}" != "--now" ]; then
  setsid nohup "$0" "$SHA" --now >> "$LOG" 2>&1 < /dev/null &
  echo "queued deploy of $SHA (log: $LOG)"
  exit 0
fi

exec 9> /run/control-scout-deploy.lock
flock 9   # one deploy at a time; a newer push waits for the running one
echo "=== $(date -u +%FT%TZ) deploy $SHA"

MIRROR="$APP_DIR/repo.git"
KEY="$APP_DIR/deploy_key"           # read-only deploy key (if the org allows deploy keys), or
TOKEN_FILE="$APP_DIR/github_token"  # a fine-grained token: this repo only, Contents read-only
if [ -s "$TOKEN_FILE" ]; then
  # The token is passed per command through an askpass helper: never written to git config or a URL.
  ASKPASS=$(mktemp); trap 'rm -f "$ASKPASS"' EXIT
  printf '#!/bin/sh\ncase "$1" in Username*) echo x-access-token;; *) cat %q;; esac\n' "$TOKEN_FILE" > "$ASKPASS"; chmod 700 "$ASKPASS"
  export GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0
  URL=https://github.com/Control-Point-FTC/control-scout.git
elif [ -f "$KEY" ]; then
  export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$APP_DIR/known_hosts"
  URL=git@github.com:Control-Point-FTC/control-scout.git
else
  echo "No credentials: need $TOKEN_FILE or $KEY (see docs/deploy.md, Auto-deploy)"; exit 1
fi
[ -d "$MIRROR" ] || git init --quiet --bare "$MIRROR"
git -C "$MIRROR" fetch --quiet "$URL" '+refs/heads/main:refs/heads/main'
git -C "$MIRROR" merge-base --is-ancestor "$SHA" refs/heads/main || { echo "$SHA is not on main; refusing"; exit 1; }

# Skip only when this commit is installed AND the running server says it's ready
# on it; a release that switched but never came up gets installed again.
PORT="$(sed -n 's/^PORT=//p' "$APP_DIR/shared/.env" | tail -n1)"
HEALTH="$(curl -fsS --max-time 5 "http://127.0.0.1:${PORT:-3100}/api/health" 2>/dev/null || true)"
if [ "$(cat "$APP_DIR/current/RELEASE" 2>/dev/null)" = "$SHA" ] && echo "$HEALTH" | grep -q "\"release\":\"$SHA\"" && echo "$HEALTH" | grep -q '"ready":true'; then
  echo "$SHA is already live and ready"; exit 0
fi

RELEASE="$(date -u +%Y%m%d%H%M%S)-${SHA:0:7}"
REL_DIR="$APP_DIR/releases/$RELEASE"
install -d -o root -g root -m 755 "$REL_DIR"
git -C "$MIRROR" archive "$SHA" | tar -x -C "$REL_DIR"
echo "$SHA" > "$REL_DIR/RELEASE"

# Domains saved by the last install (DOMAIN, EXTRA_DOMAINS); not secret.
# shellcheck disable=SC1091
. "$APP_DIR/shared/deploy.conf"
RELEASE="$RELEASE" DOMAIN="$DOMAIN" EXTRA_DOMAINS="${EXTRA_DOMAINS:-}" bash "$REL_DIR/deploy/oracle-vm-setup.sh"
echo "=== $(date -u +%FT%TZ) deployed $SHA as $RELEASE"

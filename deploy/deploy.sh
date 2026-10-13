#!/bin/bash
# Ship the current commit to the Oracle VM and (re)install Control Scout.
#
#   VM=ubuntu@132.145.202.89 KEY=~/.ssh/oracle-controlpoint bash deploy/deploy.sh
#   (first time also: DOMAIN=scout.tryctrlpoint.org CERTBOT_EMAIL=you@example.com)
#
# Copies `git archive HEAD` into /opt/control-scout (keeping .env and .data),
# then runs deploy/oracle-vm-setup.sh there. Never touches /opt/control-point.
set -euo pipefail
VM="${VM:?set VM=user@host}"
KEY="${KEY:-$HOME/.ssh/oracle-controlpoint}"
APP_DIR=/opt/control-scout
SSH="ssh -i $KEY -o BatchMode=yes $VM"

[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Commit your changes first (the archive is HEAD)."; exit 1; }
echo "Shipping $(git rev-parse --short HEAD) to $VM:$APP_DIR"
TMP=$($SSH 'mktemp -d /tmp/cs-new.XXXXXXXX')
git archive HEAD | $SSH "tar -x -C '$TMP'"
$SSH "sudo bash -s" <<REMOTE
set -e
mkdir -p $APP_DIR
# Replace code, keep secrets and data.
find $APP_DIR -mindepth 1 -maxdepth 1 ! -name .env ! -name .data ! -name node_modules -exec rm -rf {} +
cp -a $TMP/. $APP_DIR/
rm -rf $TMP
DOMAIN='${DOMAIN:-scout.tryctrlpoint.org}' CERTBOT_EMAIL='${CERTBOT_EMAIL:-}' bash $APP_DIR/deploy/oracle-vm-setup.sh
REMOTE

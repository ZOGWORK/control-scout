#!/bin/bash
# Ship the current commit to the Oracle VM and (re)install Control Scout.
#
#   VM=ubuntu@132.145.202.89 KEY=~/.ssh/oracle-controlpoint bash deploy/deploy.sh
#   Production: DOMAIN=controlscout.org EXTRA_DOMAINS="www.controlscout.org scout.tryctrlpoint.org"
#   (DOMAIN defaults to scout.tryctrlpoint.org; CERTBOT_EMAIL only on a VM without a Let's Encrypt account)
#
# Uploads `git archive HEAD` as a new release under /opt/control-scout/releases,
# then runs that release's deploy/oracle-vm-setup.sh, which builds it and only
# then switches the live site over. Never touches /opt/control-point.
set -euo pipefail
VM="${VM:?set VM=user@host}"
KEY="${KEY:-$HOME/.ssh/oracle-controlpoint}"
APP_DIR=/opt/control-scout
SSH="ssh -i $KEY -o BatchMode=yes $VM"

[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Commit your changes first (the archive is HEAD)."; exit 1; }
RELEASE="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"
echo "Shipping release $RELEASE to $VM"
TMP=$($SSH 'mktemp -d /tmp/cs-new.XXXXXXXX')
git archive HEAD | $SSH "tar -x -C '$TMP'"
$SSH "sudo bash -s" <<REMOTE
set -e
install -d -o root -g root -m 755 $APP_DIR $APP_DIR/releases
mv '$TMP' $APP_DIR/releases/$RELEASE
chown -R root:root $APP_DIR/releases/$RELEASE
chmod 755 $APP_DIR/releases/$RELEASE   # mktemp made it 700; the app user must read it
RELEASE='$RELEASE' DOMAIN='${DOMAIN:-scout.tryctrlpoint.org}' EXTRA_DOMAINS='${EXTRA_DOMAINS:-}' CERTBOT_EMAIL='${CERTBOT_EMAIL:-}' APP_PORT='${APP_PORT:-}' \
  bash $APP_DIR/releases/$RELEASE/deploy/oracle-vm-setup.sh
REMOTE

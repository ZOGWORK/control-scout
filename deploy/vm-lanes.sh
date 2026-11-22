#!/bin/bash
# Turn the zero-gap hand-off (deploy/lanes.sh) on or off on the Oracle VM. Installed by oracle-vm-setup.sh as
# /opt/control-scout/bin/lanes; a one-time step (docs/deploy.md, "Zero-gap hand-off"):
#
#   sudo /opt/control-scout/bin/lanes status
#   sudo /opt/control-scout/bin/lanes enable    # control-scout.service → control-scout@a, without a gap
#   sudo /opt/control-scout/bin/lanes disable   # back to control-scout.service, without a gap
#
# Both switch the way a deploy then does: the new unit starts from `current` beside the one serving, takes the
# socket once it's warm, and only then is the old one stopped. The socket stays open throughout.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/control-scout}"
# shellcheck source=deploy/lanes.sh
. "$(dirname "$(readlink -f "$0")")/lanes.sh"
U="$LANES_UNIT"
SOCKET_FILE="$LANES_SYSTEMD_DIR/$U.socket"
[ "$(id -u)" = 0 ] || [ -n "${LANES_TEST:-}" ] || { echo "Run with sudo"; exit 1; }

status() {
  if lanes_on; then echo "lanes: on (serving: $(lanes_live | tr '\n' ' '))"; else echo "lanes: off ($U.service: $(systemctl is-active "$U.service" || true))"; fi
}

case "${1:-status}" in
  status) status ;;
  enable)
    exec 8> "${LANES_LOCK:-/run/control-scout-install.lock}"
    flock 8   # never alongside a deploy or a rollback
    lanes_on && { status; exit 0; }
    [ -f "$APP_DIR/current/server/listen.ts" ] || { echo "The live release predates socket activation; deploy a newer one first"; exit 1; }
    systemctl is-active --quiet "$U.socket" || { echo "$U.socket isn't running; deploy once first"; exit 1; }
    lanes_write_template
    # Lane a becomes the socket's own service. Applied by the reload alone: the socket keeps its open port.
    grep -q "^Service=$U@a.service\$" "$SOCKET_FILE" || { new="$(lanes_socket < "$SOCKET_FILE")"; printf '%s\n' "$new" > "$SOCKET_FILE"; }
    systemctl daemon-reload
    if lanes_switch handoff; then status; exit 0; fi
    # Lane a never got ready ($U.service is still serving): put the single unit back as it was.
    rm -f "$(lanes_template_file)"
    sed -i "/^Service=$U@a.service\$/d" "$SOCKET_FILE"
    systemctl daemon-reload
    echo "lanes: not enabled; $U.service is still serving"
    exit 1
    ;;
  disable)
    exec 8> "${LANES_LOCK:-/run/control-scout-install.lock}"
    flock 8
    lanes_on || { status; exit 0; }
    # The single unit is the socket's service again (it has no Sockets= of its own), then it takes over from the lane.
    sed -i "/^Service=$U@a.service\$/d" "$SOCKET_FILE"
    systemctl daemon-reload
    systemctl enable --quiet "$U.service"
    t0="$(date +%s)"
    systemctl start "$U.service"
    if lanes_wait_unit "$U.service" "$t0"; then
      for l in a b; do
        systemctl is-active --quiet "$U@$l.service" && systemctl stop "$U@$l.service"
        systemctl disable --quiet "$U@$l.service" 2>/dev/null || true
      done
      rm -f "$(lanes_template_file)"
      systemctl daemon-reload
      status
    else
      systemctl stop "$U.service" || true
      systemctl disable --quiet "$U.service" 2>/dev/null || true
      grep -q "^Service=$U@a.service\$" "$SOCKET_FILE" || { new="$(lanes_socket < "$SOCKET_FILE")"; printf '%s\n' "$new" > "$SOCKET_FILE"; }
      systemctl daemon-reload
      echo "lanes: still on; $U.service never got ready"
      exit 1
    fi
    ;;
  *) echo "usage: lanes [status|enable|disable]"; exit 2 ;;
esac

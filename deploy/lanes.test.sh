#!/usr/bin/env bash
# Tests for deploy/lanes.sh and deploy/vm-lanes.sh: `bash deploy/lanes.test.sh` (CI runs it).
#
# Each case runs the real functions with fake `systemctl`, `journalctl` and `flock` first on PATH:
#   systemctl  keeps each unit's state as files under $FAKE_DIR (active/<unit>, enabled/<unit>, failed/<unit>) and
#              logs every call to calls.log. Starting a unit logs the server's "listening" line to its journal at
#              once, unless the unit is named in $FAKE_DIR/never-ready (it then stays up but never takes the socket)
#              or in $FAKE_DIR/fails (it fails to start).
#   journalctl answers `-u <unit>` from that journal.
# Nothing touches the real systemd. The hand-off itself was proven on the VM against throwaway units (docs/deploy.md).

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PASS=0 FAIL=0

make_fakes() {
  mkdir -p "$T/bin" "$T/fake/active" "$T/fake/enabled" "$T/fake/journal" "$T/fake/failed" "$T/systemd"
  cat >"$T/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >>"$FAKE_DIR/calls.log"
quiet=0 args=()
for a in "$@"; do case $a in --quiet|-q) quiet=1 ;; --*) ;; *) args+=("$a") ;; esac; done
cmd=${args[0]:-}; units=("${args[@]:1}")
unit() { case $1 in *.service|*.socket) echo "$1" ;; *) echo "$1.service" ;; esac; }
start() {
  local u; u=$(unit "$1"); [ -e "$FAKE_DIR/active/$u" ] && return 0
  if grep -qx "$u" "$FAKE_DIR/fails" 2>/dev/null; then touch "$FAKE_DIR/failed/$u"; return 0; fi
  touch "$FAKE_DIR/active/$u"; rm -f "$FAKE_DIR/failed/$u"
  grep -qx "$u" "$FAKE_DIR/never-ready" 2>/dev/null || echo "[t] Control Scout listening on the systemd socket" >>"$FAKE_DIR/journal/$u"
}
case $cmd in
  is-active) [ -e "$FAKE_DIR/active/$(unit "${units[0]}")" ] || { [ $quiet = 1 ] || echo inactive; exit 3; }; [ $quiet = 1 ] || echo active ;;
  is-failed) [ -e "$FAKE_DIR/failed/$(unit "${units[0]}")" ] || exit 1 ;;
  start) for u in "${units[@]}"; do start "$u"; done ;;
  stop) for u in "${units[@]}"; do rm -f "$FAKE_DIR/active/$(unit "$u")"; done ;;
  restart) for u in "${units[@]}"; do rm -f "$FAKE_DIR/active/$(unit "$u")"; start "$u"; done ;;
  enable) for u in "${units[@]}"; do touch "$FAKE_DIR/enabled/$(unit "$u")"; done ;;
  disable) for u in "${units[@]}"; do rm -f "$FAKE_DIR/enabled/$(unit "$u")"; done ;;
  daemon-reload|reset-failed) ;;
  *) echo "fake systemctl: unknown $cmd" >&2; exit 1 ;;
esac
EOF
  cat >"$T/bin/journalctl" <<'EOF'
#!/usr/bin/env bash
u=""; while [ $# -gt 0 ]; do [ "$1" = -u ] && { u=$2; shift; }; shift; done
cat "$FAKE_DIR/journal/$u" 2>/dev/null || true
EOF
  printf '#!/usr/bin/env bash\nexit 0\n' >"$T/bin/flock"
  chmod +x "$T/bin/"*
  # The single unit as oracle-vm-setup.sh writes it (shortened), and the socket.
  cat >"$T/systemd/control-scout.service" <<'EOF'
[Unit]
Description=FTC Control Scout
After=network-online.target control-scout.socket
Requires=control-scout.socket

[Service]
User=controlscout
ExecStart=/usr/bin/node --enable-source-maps build/server/index.mjs

[Install]
WantedBy=multi-user.target
EOF
  printf '[Unit]\nDescription=FTC Control Scout port\n\n[Socket]\nListenStream=127.0.0.1:3100\n\n[Install]\nWantedBy=sockets.target\n' >"$T/systemd/control-scout.socket"
}

setup() {
  T=$(mktemp -d)
  make_fakes
  export PATH="$T/bin:$PATH" FAKE_DIR="$T/fake" LANES_SYSTEMD_DIR="$T/systemd" LANES_READY_SECONDS=2 LANES_POLL=1 LANES_TEST=1 LANES_LOCK="$T/lock"
  # shellcheck source=deploy/lanes.sh
  . "$HERE/lanes.sh"
}
teardown() { rm -rf "$T"; }
active() { touch "$FAKE_DIR/active/$1"; }
is_active() { [ -e "$FAKE_DIR/active/$1" ]; }
is_enabled() { [ -e "$FAKE_DIR/enabled/$1" ]; }
# The line number of a call in calls.log (0 when it isn't there).
at() { grep -nxF "systemctl $1" "$FAKE_DIR/calls.log" | head -n1 | cut -d: -f1 | grep . || echo 0; }

check() {
  local name=$1; shift
  if "$@"; then PASS=$((PASS + 1)); echo "ok   $name"; else FAIL=$((FAIL + 1)); echo "FAIL $name"; [ -f "$FAKE_DIR/calls.log" ] && sed 's/^/       /' "$FAKE_DIR/calls.log"; fi
}

case_template() {
  local t s
  t=$(lanes_template)
  s=$(lanes_socket <"$LANES_SYSTEMD_DIR/control-scout.socket")
  grep -qx 'Description=FTC Control Scout (lane %i)' <<<"$t" &&
    [ "$(grep -A1 -x '\[Service\]' <<<"$t" | tail -n1)" = "Sockets=control-scout.socket" ] &&
    [ "$(grep -A2 -x '\[Service\]' <<<"$t" | tail -n1)" = "Environment=CS_LANE=%i CS_LANE_UNIT=%p" ] &&
    grep -qx 'ExecStart=/usr/bin/node --enable-source-maps build/server/index.mjs' <<<"$t" &&
    grep -qx 'Requires=control-scout.socket' <<<"$t" &&
    [ "$(grep -A1 -x '\[Socket\]' <<<"$s" | tail -n1)" = "Service=control-scout@a.service" ] &&
    grep -qx 'ListenStream=127.0.0.1:3100' <<<"$s" &&
    ! lanes_on && lanes_write_template && lanes_on && [ "$(cat "$LANES_SYSTEMD_DIR/control-scout@.service")" = "$t" ]
}

case_handoff() {
  active control-scout@a.service
  lanes_switch handoff >/dev/null || return 1
  # b started before a stopped, and a stopped only once b had taken the socket.
  [ "$(at 'start control-scout@b.service')" -gt 0 ] && [ "$(at 'start control-scout@b.service')" -lt "$(at 'stop control-scout@a.service')" ] &&
    is_active control-scout@b.service && ! is_active control-scout@a.service &&
    is_enabled control-scout@b.service && ! is_enabled control-scout@a.service &&
    [ "$(lanes_live)" = b ]
}

case_handoff_back() {
  active control-scout@b.service
  lanes_switch handoff >/dev/null && [ "$(lanes_live)" = a ] && is_enabled control-scout@a.service
}

case_never_ready() {
  active control-scout@a.service
  echo control-scout@b.service >"$FAKE_DIR/never-ready"
  ! lanes_switch handoff >/dev/null &&
    is_active control-scout@a.service && ! is_active control-scout@b.service &&
    [ "$(at 'stop control-scout@a.service')" = 0 ] && [ "$(lanes_live)" = a ]
}

case_failed_start() {
  active control-scout@a.service
  echo control-scout@b.service >"$FAKE_DIR/fails"
  # It fails at once (an exit systemd won't restart): the wait gives up then, not after LANES_READY_SECONDS.
  local out; out=$(LANES_READY_SECONDS=30 lanes_switch handoff) && return 1
  grep -q "failed to start" <<<"$out" && is_active control-scout@a.service && ! is_active control-scout@b.service
}

case_restart() {
  active control-scout@b.service
  lanes_switch restart >/dev/null || return 1
  # The live lane stopped before lane a started: no overlap.
  [ "$(at 'stop control-scout@b.service')" -lt "$(at 'restart control-scout@a.service')" ] &&
    [ "$(lanes_live)" = a ] && is_enabled control-scout@a.service && ! is_enabled control-scout@b.service
}

case_restart_same_lane() {
  active control-scout@a.service
  lanes_switch restart >/dev/null && [ "$(at 'restart control-scout@a.service')" -gt 0 ] && [ "$(lanes_live)" = a ]
}

case_both_live() {
  active control-scout@a.service; active control-scout@b.service
  lanes_switch handoff >/dev/null && [ "$(lanes_live)" = b ] && [ "$(at 'stop control-scout@b.service')" -lt "$(at 'start control-scout@b.service')" ]
}

case_enable() {
  mkdir -p "$T/app/current/server" && touch "$T/app/current/server/listen.ts"
  active control-scout.service; active control-scout.socket; touch "$FAKE_DIR/enabled/control-scout.service"
  APP_DIR="$T/app" bash "$HERE/vm-lanes.sh" enable >/dev/null || return 1
  lanes_on && [ "$(lanes_live)" = a ] && ! is_active control-scout.service && ! is_enabled control-scout.service &&
    is_enabled control-scout@a.service && grep -qx 'Service=control-scout@a.service' "$LANES_SYSTEMD_DIR/control-scout.socket" &&
    [ "$(at 'start control-scout@a.service')" -lt "$(at 'stop control-scout.service')" ] &&
    # Enabling again changes nothing.
    APP_DIR="$T/app" bash "$HERE/vm-lanes.sh" enable | grep -q 'lanes: on' && [ "$(grep -c 'Service=' "$LANES_SYSTEMD_DIR/control-scout.socket")" = 1 ]
}

case_enable_fails() {
  mkdir -p "$T/app/current/server" && touch "$T/app/current/server/listen.ts"
  active control-scout.service; active control-scout.socket
  echo control-scout@a.service >"$FAKE_DIR/never-ready"
  ! APP_DIR="$T/app" bash "$HERE/vm-lanes.sh" enable >/dev/null &&
    ! lanes_on && is_active control-scout.service && ! is_active control-scout@a.service &&
    ! grep -q 'Service=' "$LANES_SYSTEMD_DIR/control-scout.socket"
}

case_disable() {
  mkdir -p "$T/app/current/server" && touch "$T/app/current/server/listen.ts"
  active control-scout.service; active control-scout.socket
  APP_DIR="$T/app" bash "$HERE/vm-lanes.sh" enable >/dev/null || return 1
  : >"$FAKE_DIR/calls.log"
  APP_DIR="$T/app" bash "$HERE/vm-lanes.sh" disable >/dev/null || return 1
  ! lanes_on && is_active control-scout.service && is_enabled control-scout.service && [ -z "$(lanes_live)" ] &&
    ! grep -q 'Service=' "$LANES_SYSTEMD_DIR/control-scout.socket" &&
    [ "$(at 'start control-scout.service')" -lt "$(at 'stop control-scout@a.service')" ]
}

for c in template handoff handoff_back never_ready failed_start restart restart_same_lane both_live enable enable_fails disable; do
  setup
  check "$c" "case_$c"
  teardown
done
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]

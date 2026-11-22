# Two server lanes on one socket, so a deploy hands over without a gap (docs/deploy.md, "Zero-gap hand-off").
# Sourced (never run) by oracle-vm-setup.sh, vm-rollback.sh and vm-lanes.sh; every deploy installs it beside them
# as /opt/control-scout/bin/lanes.sh.
#
# Without lanes, a deploy restarts control-scout.service: the old server stops, and requests wait in
# control-scout.socket's queue for as long as the new one takes to warm up (server/index.ts takes the socket only
# once it's ready; ~20 s on the VM). With lanes, control-scout@a and control-scout@b are two instances of one
# template, both handed the same listening socket (Sockets=; systemd passes one socket to several services at once).
# A deploy starts the idle lane from the new release while the live one keeps serving; the new lane takes the
# socket once it's warm (both accept on it for a moment), and the old lane is then stopped, finishing the requests
# it's serving first (server/listen.ts drainOnSigterm). The socket itself never closes.
#
# The lanes are on once the template unit exists (vm-lanes.sh enable, a one-time step). Until then every function
# here leaves the single service alone and the deploy restarts it as before.
#
# LANES_UNIT / LANES_SYSTEMD_DIR / LANES_READY_SECONDS / LANES_POLL / LANES_MARK point it elsewhere (tests, and the
# throwaway units the hand-off was proven on).

LANES_UNIT="${LANES_UNIT:-control-scout}"
LANES_SYSTEMD_DIR="${LANES_SYSTEMD_DIR:-/etc/systemd/system}"
# How long a new lane may take to warm up before the hand-off gives up (the old lane keeps serving meanwhile).
LANES_READY_SECONDS="${LANES_READY_SECONDS:-300}"
LANES_POLL="${LANES_POLL:-1}"
# What server/index.ts logs once it has taken the socket (after warm-up): the new lane is serving.
LANES_MARK="${LANES_MARK:-listening on the systemd socket}"

lanes_template_file() { echo "$LANES_SYSTEMD_DIR/$LANES_UNIT@.service"; }

# Are the lanes on?
lanes_on() { [ -f "$(lanes_template_file)" ]; }

# The lanes serving now, one per line (a, b).
lanes_live() {
  local l
  for l in a b; do systemctl is-active --quiet "$LANES_UNIT@$l.service" && echo "$l"; done
  return 0
}

# The template, made from the single service unit (oracle-vm-setup.sh writes it, vm-rollback.sh edits it), so both
# always start the same way: the same unit with the socket named (Sockets=) and the lane in its description. The
# server is told its lane and unit (CS_LANE, CS_LANE_UNIT: server/lanes.ts), so a lane started while the other one
# serves knows it's a hand-off and finishes warming up before it takes the socket.
lanes_template() {
  sed -e 's/^Description=\(.*\)$/Description=\1 (lane %i)/' \
      -e "s/^\[Service\]\$/[Service]\nSockets=$LANES_UNIT.socket\nEnvironment=CS_LANE=%i CS_LANE_UNIT=%p/" "$LANES_SYSTEMD_DIR/$LANES_UNIT.service"
}

# Write the template from the single unit (call systemctl daemon-reload after). Changes nothing that's running.
lanes_write_template() {
  local t new
  t="$(lanes_template_file)"
  new="$(lanes_template)"
  [ "$(cat "$t" 2>/dev/null)" = "$new" ] || printf '%s\n' "$new" > "$t"
}

# The socket unit as the lanes need it (stdin → stdout): lane a is the service it starts when a request comes in and
# no lane is up (an operator stopped both, or the moment between the two steps of a restart below), instead of the
# single service.
lanes_socket() { sed "s/^\[Socket\]\$/[Socket]\nService=$LANES_UNIT@a.service/"; }

# Wait until the unit $1, started at or after epoch second $2, has taken the socket. Fails when it stops for good or
# isn't ready within LANES_READY_SECONDS.
lanes_wait_unit() {
  local unit="$1" since="$2" waited=0
  while [ "$waited" -lt "$LANES_READY_SECONDS" ]; do
    if journalctl -u "$unit" --since "@$since" -o cat --no-pager -q 2>/dev/null | grep -qF "$LANES_MARK"; then
      systemctl is-active --quiet "$unit" && return 0
    fi
    if systemctl is-failed --quiet "$unit"; then echo "lanes: $unit failed to start (journalctl -u $unit)"; return 1; fi
    sleep "$LANES_POLL"
    waited=$((waited + LANES_POLL))
  done
  echo "lanes: $unit wasn't ready after ${LANES_READY_SECONDS} s (journalctl -u $unit)"
  return 1
}
lanes_wait_ready() { lanes_wait_unit "$LANES_UNIT@$1.service" "$2"; }

# Start a lane from `current` and make it the only one serving.
#   handoff: start the idle lane; the live one keeps serving until the new one has taken the socket, then stops.
#            If the new lane never gets ready it's stopped again and the live one carries on (returns 1).
#   restart: stop whatever is serving first, then start lane a (the socket's own lane, so a request in between starts
#            that same lane rather than another): no overlap at all, and requests wait in the socket's queue
#            meanwhile, as without lanes. For a release that mustn't run beside the old one (deploy/handoff-gate.mjs).
lanes_switch() {
  local mode="$1" u="$LANES_UNIT" live new l t0 others=0
  live="$(lanes_live)"
  if [ "$mode" = restart ]; then
    new=a
    for l in $live; do [ "$l" = a ] || systemctl stop "$u@$l.service"; done
    systemctl stop "$u.service" 2>/dev/null || true
    t0="$(date +%s)"
    systemctl restart "$u@a.service"
  else
    # The idle lane; with both up (never left so, but possible by hand), lane b is stopped and started fresh.
    if printf '%s\n' "$live" | grep -qx a; then new=b; else new=a; fi
    systemctl stop "$u@$new.service" 2>/dev/null || true
    for l in $live; do [ "$l" = "$new" ] || others=1; done
    systemctl is-active --quiet "$u.service" && others=1
    systemctl reset-failed "$u@$new.service" 2>/dev/null || true
    t0="$(date +%s)"
    systemctl start "$u@$new.service"
  fi
  if ! lanes_wait_ready "$new" "$t0"; then
    # Leave the old one serving (handoff); with nothing else up, the new lane keeps trying (Restart=always).
    [ "$others" = 1 ] && systemctl stop "$u@$new.service"
    return 1
  fi
  # The new lane is taking requests: stop the others. Each finishes the requests it's serving first (up to 10 s).
  for l in a b; do
    [ "$l" = "$new" ] && continue
    if systemctl is-active --quiet "$u@$l.service"; then systemctl stop "$u@$l.service"; fi
    systemctl disable --quiet "$u@$l.service" 2>/dev/null || true
  done
  if systemctl is-active --quiet "$u.service"; then systemctl stop "$u.service"; fi
  systemctl disable --quiet "$u.service" 2>/dev/null || true
  # Started at boot from now on (WantedBy=multi-user.target, as the single service was).
  systemctl enable --quiet "$u@$new.service"
  echo "lanes: $u@$new is serving"
}

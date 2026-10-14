#!/usr/bin/env bash
# Tests for uptime.sh: `bash .github/scripts/uptime.test.sh` (CI runs it).
#
# Each case runs the real script with fake `curl` and `gh` first on PATH:
#   curl  answers from a queue file, one line per request:
#           <curl exit> <http code> <content type> <body…>
#         (an empty queue means "connection refused"), and logs each URL.
#   gh    logs every call to gh.log and answers from env vars:
#           FAKE_ISSUE (open issue number), FAKE_CREATED / FAKE_LAST (ISO times),
#           FAKE_LIST_RC / FAKE_CREATE_RC / FAKE_COMMENT_RC / FAKE_CLOSE_RC (exit codes).
# Nothing touches the network or a real repository. RETRY_SLEEP=0 keeps it fast.

set -uo pipefail
SCRIPT="$(cd "$(dirname "$0")" && pwd)/uptime.sh"
PASS=0 FAIL=0

UP_HEALTH='0 200 application/json {"ok":true,"engine":"1.1.0","release":"abc1234","ready":true}'
UP_HOME='0 200 text/html;charset=utf-8 <!doctype html><title>Control Scout</title>'
STARTING='0 503 application/json {"ok":true,"engine":"1.1.0","release":"abc1234","ready":false}'

ago() { date -u -d "$1 minutes ago" +%Y-%m-%dT%H:%M:%SZ; }

make_fakes() {
  mkdir -p "$T/bin"
  cat >"$T/bin/curl" <<'EOF'
#!/usr/bin/env bash
out=/dev/null url=""
while [ $# -gt 0 ]; do
  case $1 in -o) out=$2; shift ;; -w|-H|--max-time) shift ;; -*) ;; *) url=$1 ;; esac
  shift
done
echo "$url" >>"$FAKE_DIR/curl.log"
line=$(head -n 1 "$FAKE_DIR/queue" 2>/dev/null); sed -i 1d "$FAKE_DIR/queue" 2>/dev/null
[ -n "$line" ] || line="7 000 - "
read -r rc code ctype body <<<"$line"
[ "$ctype" = - ] && ctype=""
printf '%s' "$body" >"$out"
printf '%s 0.01 %s' "$code" "$ctype"
[ "$rc" = 0 ] || echo "curl: ($rc) fake failure" >&2
exit "$rc"
EOF
  cat >"$T/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "gh $*" >>"$FAKE_DIR/gh.log"
case "$1 $2" in
  "issue list")    [ -n "${FAKE_ISSUE:-}" ] && echo "$FAKE_ISSUE"; exit "${FAKE_LIST_RC:-0}" ;;
  "issue view")    if [[ "$*" == *comments* ]]; then echo "${FAKE_LAST:-}"; else echo "${FAKE_CREATED:-}"; fi ;;
  "issue create")  exit "${FAKE_CREATE_RC:-0}" ;;
  "issue comment") exit "${FAKE_COMMENT_RC:-0}" ;;
  "issue close")   exit "${FAKE_CLOSE_RC:-0}" ;;
  "label create")  exit 1 ;;   # "already exists": must not matter
  *) echo "unexpected gh call: $*" >&2; exit 99 ;;
esac
EOF
  chmod +x "$T/bin/curl" "$T/bin/gh"
}

# run "<name>" <queue lines…> -- [VAR=value…]
run() {
  NAME=$1; shift
  T=$(mktemp -d); make_fakes; : >"$T/queue"; : >"$T/gh.log"; : >"$T/curl.log"
  while [ $# -gt 0 ] && [ "$1" != -- ]; do echo "$1" >>"$T/queue"; shift; done
  [ "${1:-}" = -- ] && shift
  OUT=$(env PATH="$T/bin:$PATH" FAKE_DIR="$T" SITE=https://example.test RETRY_SLEEP=0 DRY_RUN=0 \
    GITHUB_REPOSITORY=o/r GITHUB_RUN_ID=1 "$@" bash "$SCRIPT" 2>&1)
  CODE=$?
  GHLOG=$(cat "$T/gh.log"); CURLS=$(wc -l <"$T/curl.log" | tr -d ' ')
  rm -rf "$T"
}

check() {  # check <description> <condition…>
  local what=$1; shift
  if "$@"; then PASS=$((PASS + 1)); else
    FAIL=$((FAIL + 1)); echo "FAIL [$NAME] $what"; echo "  exit=$CODE curls=$CURLS"
    sed 's/^/  out| /' <<<"$OUT"; sed 's/^/  gh | /' <<<"$GHLOG"
  fi
}
exit_is() { [ "$CODE" = "$1" ]; }
gh_called() { grep -q -- "$1" <<<"$GHLOG"; }
gh_not_called() { ! grep -q -- "$1" <<<"$GHLOG"; }
out_has() { grep -q -- "$1" <<<"$OUT"; }
out_lacks() { ! grep -q -- "$1" <<<"$OUT"; }

# --- the check -------------------------------------------------------------

run "up, no issue" "$UP_HEALTH" "$UP_HOME" -- FAKE_ISSUE=
check "exits 0" exit_is 0
check "two requests" [ "$CURLS" = 2 ]
check "no writes" gh_not_called "issue c"

run "down after 3 failed attempts" "$STARTING" "$STARTING" "$STARTING" -- FAKE_ISSUE=
check "exits 1" exit_is 1
check "tried 3 times" [ "$CURLS" = 3 ]
check "opens an issue" gh_called "issue create --label uptime --title controlscout.org is down"
check "issue names the failure" gh_called "HTTP 503"

run "recovers on attempt 2 (deploy restart)" "$STARTING" "$UP_HEALTH" "$UP_HOME" -- FAKE_ISSUE=
check "exits 0" exit_is 0
check "says up on attempt 2" out_has "Attempt 2/3: up"
check "no issue" gh_not_called "issue create"

# 200 + HTML headers, but the body stalls (28) or is cut off (18): not up.
run "home 200 html but curl exit 28" "$UP_HEALTH" "28 200 text/html <!doctype" \
  "$UP_HEALTH" "18 200 text/html <!doc" "$UP_HEALTH" "28 200 text/html <" -- FAKE_ISSUE=
check "exits 1" exit_is 1
check "reports curl's exit and error" out_has "curl exit 28: curl: (28) fake failure"
check "opens an issue" gh_called "issue create"

run "health 200 ready but curl exit 56" '56 200 application/json {"ready":true}' \
  '56 200 application/json {"ready":true}' '56 200 application/json {"ready":true}' -- FAKE_ISSUE=
check "exits 1" exit_is 1
check "reports curl's exit" out_has "curl exit 56"

run "home not HTML" "$UP_HEALTH" "0 200 application/json {}" "$UP_HEALTH" "0 200 application/json {}" \
  "$UP_HEALTH" "0 200 application/json {}" -- FAKE_ISSUE=
check "exits 1" exit_is 1
check "says why" out_has "not HTML"

run "connection refused" -- FAKE_ISSUE=
check "exits 1" exit_is 1
check "HTTP 000 + curl error" out_has "HTTP 000 in 0.01s, curl exit 7"

# --- still down: hourly throttle ---------------------------------------------

run "still down, last comment 10 min ago" -- FAKE_ISSUE=7 FAKE_LAST="$(ago 10)"
check "exits 1" exit_is 1
check "no comment" gh_not_called "issue comment"
check "no new issue" gh_not_called "issue create"

run "still down, last comment 90 min ago" -- FAKE_ISSUE=7 FAKE_LAST="$(ago 90)"
check "exits 1" exit_is 1
check "comments" gh_called "issue comment 7 --body Still down."

# --- recovery -----------------------------------------------------------------

run "recovery: comment + close" "$UP_HEALTH" "$UP_HOME" -- FAKE_ISSUE=7 FAKE_CREATED="$(ago 37)"
check "exits 0" exit_is 0
check "comments with the downtime" gh_called "issue comment 7 --body Back up at .* (down ~37 min)"
check "closes" gh_called "issue close 7"
check "comment comes before close" [ "$(grep -n 'issue comment' <<<"$GHLOG" | cut -d: -f1)" -lt "$(grep -n 'issue close' <<<"$GHLOG" | cut -d: -f1)" ]

run "recovery: comment fails" "$UP_HEALTH" "$UP_HOME" -- FAKE_ISSUE=7 FAKE_CREATED="$(ago 5)" FAKE_COMMENT_RC=1
check "exits nonzero" [ "$CODE" != 0 ]
check "does not close" gh_not_called "issue close"
check "does not claim it closed" out_lacks "Closed #7"

run "recovery: close fails" "$UP_HEALTH" "$UP_HOME" -- FAKE_ISSUE=7 FAKE_CREATED="$(ago 5)" FAKE_CLOSE_RC=1
check "exits nonzero" [ "$CODE" != 0 ]
check "tried to close" gh_called "issue close 7"
check "does not claim it closed" out_lacks "Closed #7"

# --- GitHub trouble -----------------------------------------------------------

run "gh issue list fails while down" -- FAKE_LIST_RC=1
check "exits 1" exit_is 1
check "no duplicate issue" gh_not_called "issue create"
check "says so" out_has "Couldn't list open 'uptime' issues"

run "issue create fails" -- FAKE_ISSUE= FAKE_CREATE_RC=1
check "exits 1" exit_is 1
check "says so" out_has "Opening the uptime issue failed"

echo "uptime.sh: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]

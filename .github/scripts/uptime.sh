#!/usr/bin/env bash
# Uptime check for controlscout.org, run by .github/workflows/uptime.yml.
#
# The site is UP when, within one run, some attempt finds both:
#   $SITE/api/health  -> HTTP 200 with "ready": true
#   $SITE/            -> HTTP 200 with an HTML content type
# It tries $ATTEMPTS times, $DELAY seconds apart, so a blip or a deploy
# restart (~10 s, during which /api/health answers 503 + Retry-After or
# ready:false) never pages anyone. Only a failure that lasts across every
# attempt counts as DOWN.
#
# DOWN: open an issue labelled `uptime` (or, if one is open, comment on it at
#       most once every $REPEAT_MINUTES), then exit 1 so the run fails too.
# UP:   if an `uptime` issue is open, comment "Back up at …" and close it.
#
# GitHub emails the repo's watchers about the issue, and the workflow's owner
# about the failed scheduled run. Render (the rollback host) is not checked:
# it sleeps when idle on the free plan, which is not an outage.
#
# Env:
#   SITE            default https://controlscout.org
#   ATTEMPTS        default 3
#   DELAY           seconds between attempts, default 20
#   TIMEOUT         curl --max-time per request, default 30
#   REPEAT_MINUTES  minimum gap between "still down" comments, default 60
#   DRY_RUN=1       print the gh calls instead of making them (local testing)
#   CHECK_ONLY=1    only run the check and exit 0 (up) / 1 (down); no issues
#   GH_TOKEN, GH_REPO  for gh (the workflow sets both)
# Needs bash, curl, gh (gh's built-in --jq is used, so no separate jq).

set -uo pipefail

SITE="${SITE:-https://controlscout.org}"
ATTEMPTS="${ATTEMPTS:-3}"
DELAY="${DELAY:-20}"
TIMEOUT="${TIMEOUT:-30}"
REPEAT_MINUTES="${REPEAT_MINUTES:-60}"
DRY_RUN="${DRY_RUN:-0}"
LABEL=uptime

now_utc() { date -u +"%Y-%m-%d %H:%M:%S UTC"; }

# Whole minutes since an ISO time from the GitHub API; 999999 if it is missing.
minutes_since() {
  local t
  t=$(date -u -d "${1:-x}" +%s 2>/dev/null) || { echo 999999; return; }
  echo $(( ($(date -u +%s) - t) / 60 ))
}

# gh, or in DRY_RUN a printout of what would have run (reads stay real when
# a token is around, so the dry run sees the repo's actual open issues).
gh_write() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '[dry-run] gh'; printf ' %q' "$@"; printf '\n'
  else
    gh "$@"
  fi
}

# One GET. Prints "<http code> <seconds> <content type>" on the first line and
# the first 300 bytes of the body (one line) on the second. Code 000 = no
# answer (refused, DNS, TLS or timeout); curl's own error goes in the body.
fetch() {
  local url=$1 tmp errf out
  tmp=$(mktemp); errf=$(mktemp)
  out=$(curl -sS -o "$tmp" --max-time "$TIMEOUT" -H 'Cache-Control: no-cache' \
    -w '%{http_code} %{time_total}s %{content_type}' "$url" 2>"$errf")
  echo "${out:-000 ${TIMEOUT}s -}"
  if [ -s "$tmp" ]; then head -c 300 "$tmp"; else cat "$errf"; fi | tr '\r\n' '  '
  echo
  rm -f "$tmp" "$errf"
}

# One attempt at both URLs. Returns 0 if both pass; on failure leaves a
# one-line reason in $REASON.
check_once() {
  local res head body code ctype
  res=$(fetch "$SITE/api/health")
  head=$(sed -n 1p <<<"$res"); body=$(sed -n 2p <<<"$res")
  code=${head%% *}
  if [ "$code" != "200" ]; then
    REASON="GET /api/health -> HTTP $code in ${head#* } body: ${body:-<empty>}"
    return 1
  fi
  # Our own JSON ({ok, engine, release, ready}); a regex keeps this jq-free.
  if ! grep -Eq '"ready"[[:space:]]*:[[:space:]]*true' <<<"$body"; then
    REASON="GET /api/health -> HTTP 200 but not ready: $body"
    return 1
  fi
  HEALTH="$body"

  res=$(fetch "$SITE/")
  head=$(sed -n 1p <<<"$res"); body=$(sed -n 2p <<<"$res")
  code=${head%% *}
  ctype=$(cut -d' ' -f3- <<<"$head")
  if [ "$code" != "200" ]; then
    REASON="GET / -> HTTP $code in $(cut -d' ' -f2 <<<"$head") body: ${body:-<empty>}"
    return 1
  fi
  if [[ "$ctype" != text/html* ]]; then
    REASON="GET / -> HTTP 200 but content type '$ctype', not HTML"
    return 1
  fi
  return 0
}

# Up to $ATTEMPTS tries. Returns 0 on the first full pass. FAILURES collects
# every attempt's reason for the issue body.
check_site() {
  FAILURES=""
  local i
  for ((i = 1; i <= ATTEMPTS; i++)); do
    if check_once; then
      echo "Attempt $i/$ATTEMPTS: up. $HEALTH"
      return 0
    fi
    echo "Attempt $i/$ATTEMPTS: $REASON"
    FAILURES+="$(now_utc) attempt $i/$ATTEMPTS: $REASON"$'\n'
    [ "$i" -lt "$ATTEMPTS" ] && sleep "$DELAY"
  done
  return 1
}

# Number of an open `uptime` issue (the newest), or empty.
open_issue() {
  gh issue list --label "$LABEL" --state open --limit 1 --json number --jq '.[0].number // empty'
}

main() {
  echo "Checking $SITE ($ATTEMPTS attempts, ${DELAY}s apart, ${TIMEOUT}s timeout)"
  if check_site; then up=1; else up=0; fi

  if [ "${CHECK_ONLY:-0}" = "1" ]; then
    [ "$up" = 1 ] && { echo "UP"; exit 0; } || { echo "DOWN"; exit 1; }
  fi

  # If GitHub can't be asked, stop rather than guess "no issue" and open a duplicate.
  if ! issue=$(open_issue); then
    echo "::error::Couldn't list open '$LABEL' issues (site is $([ "$up" = 1 ] && echo up || echo DOWN))."
    exit 1
  fi

  if [ "$up" = 1 ]; then
    if [ -n "$issue" ]; then
      # How long it was down: from the issue's creation to now.
      opened=$(gh issue view "$issue" --json createdAt --jq .createdAt)
      mins=$(minutes_since "$opened")
      gh_write issue comment "$issue" --body "Back up at $(now_utc) (down ~$mins min). Last health: \`$HEALTH\`"
      gh_write issue close "$issue"
      echo "Closed #$issue."
    fi
    exit 0
  fi

  echo "::error::$SITE is down: $REASON"
  # The failures go in a code block, so an HTML body snippet shows as text.
  fence='```'
  details="Checked by [uptime run]($RUN_URL) at $(now_utc). Every attempt failed:

$fence
$(tr '`' "'" <<<"$FAILURES")
$fence
"

  if [ -z "$issue" ]; then
    gh_write label create "$LABEL" --color B60205 \
      --description "controlscout.org is down (opened and closed by the uptime workflow)" 2>/dev/null || true
    gh_write issue create --label "$LABEL" --title "controlscout.org is down" --body "$details
**Where to look**
- Service log on the VM: \`sudo journalctl -u control-scout -n 200\`
- Last deploy: \`sudo tail -n 100 /var/log/control-scout-deploy.log\`
- Restart, rollback and failover to Render: [docs/deploy.md](${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-Control-Point-FTC/control-scout}/blob/main/docs/deploy.md)

The uptime workflow closes this issue by itself when the site answers again."
  else
    # Still down: comment at most once every $REPEAT_MINUTES so the issue
    # (and everyone's inbox) doesn't get a message every 5 minutes.
    last=$(gh issue view "$issue" --json createdAt,comments --jq '(.comments | last | .createdAt) // .createdAt')
    age=$(minutes_since "$last")   # 999999 if unknown: better one extra comment than none
    if [ "$age" -ge "$REPEAT_MINUTES" ]; then
      gh_write issue comment "$issue" --body "Still down. $details"
    else
      echo "#$issue is open; last update ${age} min ago, next comment after ${REPEAT_MINUTES} min."
    fi
  fi
  exit 1
}

RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"
# Sourcing the file (for tests) defines the functions without running main.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi

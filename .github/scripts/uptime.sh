#!/usr/bin/env bash
# Uptime check for controlscout.org, run by .github/workflows/uptime.yml.
#
# The site is UP when, within one run, some attempt finds both:
#   $SITE/api/health  -> HTTP 200 with "ready": true
#   $SITE/            -> HTTP 200 with an HTML content type
# It tries $ATTEMPTS times, $RETRY_SLEEP seconds apart, so a blip or a deploy
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
#   RETRY_SLEEP     seconds between attempts, default 20
#   TIMEOUT         curl --max-time per request, default 30
#   REPEAT_MINUTES  minimum gap between "still down" comments, default 60
#   DRY_RUN=1       print the gh calls instead of making them (local testing)
#   CHECK_ONLY=1    only run the check and exit 0 (up) / 1 (down); no issues
#   GH_TOKEN, GH_REPO  for gh (the workflow sets both)
# Needs bash, curl, gh (gh's built-in --jq is used, so no separate jq).

set -uo pipefail

SITE="${SITE:-https://controlscout.org}"
ATTEMPTS="${ATTEMPTS:-3}"
RETRY_SLEEP="${RETRY_SLEEP:-20}"
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

# One GET of $SITE$1. Sets, for the caller:
#   F_RC     curl's exit status (0 = the whole body arrived; 28 = timed out,
#            18/56 = cut off mid-body, 7 = refused, 6 = DNS …)
#   F_CODE   HTTP status (000 = no answer at all)
#   F_TIME   seconds taken, F_CTYPE content type
#   F_BODY   first 300 bytes of the body, on one line
#   F_ERR    curl's own error message, on one line
fetch() {
  local tmp errf out
  tmp=$(mktemp); errf=$(mktemp)
  out=$(curl -sS -o "$tmp" --max-time "$TIMEOUT" -H 'Cache-Control: no-cache' \
    -w '%{http_code} %{time_total} %{content_type}' "$SITE$1" 2>"$errf")
  F_RC=$?
  read -r F_CODE F_TIME F_CTYPE <<<"$out"
  F_CODE=${F_CODE:-000}; F_TIME=${F_TIME:-?}; F_CTYPE=${F_CTYPE:-}
  F_BODY=$(head -c 300 "$tmp" | tr '\r\n' '  ')
  F_ERR=$(tr '\r\n' '  ' <"$errf")
  rm -f "$tmp" "$errf"
}

# A one-line account of the last fetch, for failure reasons.
describe() {
  local d="GET $1 -> HTTP $F_CODE in ${F_TIME}s"
  [ "$F_RC" != 0 ] && d+=", curl exit $F_RC: ${F_ERR:-no message}"
  echo "$d; body: ${F_BODY:-<empty>}"
}

# One attempt at both URLs. Returns 0 if both pass; on failure leaves a
# one-line reason in $REASON. A 200 whose body never fully arrives (curl
# exits nonzero) is a failure, even if the headers looked fine.
check_once() {
  fetch /api/health
  if [ "$F_RC" != 0 ] || [ "$F_CODE" != 200 ]; then
    REASON=$(describe /api/health); return 1
  fi
  # Our own JSON ({ok, engine, release, ready}); a regex keeps this jq-free.
  if ! grep -Eq '"ready"[[:space:]]*:[[:space:]]*true' <<<"$F_BODY"; then
    REASON="GET /api/health -> HTTP 200 but not ready: $F_BODY"; return 1
  fi
  HEALTH="$F_BODY"

  fetch /
  if [ "$F_RC" != 0 ] || [ "$F_CODE" != 200 ]; then
    REASON=$(describe /); return 1
  fi
  if [[ "$F_CTYPE" != text/html* ]]; then
    REASON="GET / -> HTTP 200 but content type '$F_CTYPE', not HTML"; return 1
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
    [ "$i" -lt "$ATTEMPTS" ] && sleep "$RETRY_SLEEP"
  done
  return 1
}

# Number of an open `uptime` issue (the newest), or empty.
open_issue() {
  gh issue list --label "$LABEL" --state open --limit 1 --json number --jq '.[0].number // empty'
}

main() {
  echo "Checking $SITE ($ATTEMPTS attempts, ${RETRY_SLEEP}s apart, ${TIMEOUT}s timeout)"
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
      # Comment first; close only once the comment is there, so the issue
      # never closes without saying why. Either failing fails the run, and
      # the next run (issue still open) tries again.
      if ! gh_write issue comment "$issue" --body "Back up at $(now_utc) (down ~$mins min). Last health: \`$HEALTH\`"; then
        echo "::error::Site is up, but commenting on #$issue failed; left it open."
        exit 1
      fi
      if ! gh_write issue close "$issue"; then
        echo "::error::Site is up and #$issue has the recovery comment, but closing it failed."
        exit 1
      fi
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
    # The label is best-effort (it usually exists); the issue is the alert.
    gh_write issue create --label "$LABEL" --title "controlscout.org is down" --body "$details
**Where to look**
- Service log on the VM: \`sudo journalctl -u control-scout -n 200\`
- Last deploy: \`sudo tail -n 100 /var/log/control-scout-deploy.log\`
- Restart, rollback and failover to Render: [docs/deploy.md](${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-Control-Point-FTC/control-scout}/blob/main/docs/deploy.md)

The uptime workflow closes this issue by itself when the site answers again." \
      || echo "::error::Opening the uptime issue failed; the failed run is the only alert."
  else
    # Still down: comment at most once every $REPEAT_MINUTES so the issue
    # (and everyone's inbox) doesn't get a message every 5 minutes.
    last=$(gh issue view "$issue" --json createdAt,comments --jq '(.comments | last | .createdAt) // .createdAt')
    age=$(minutes_since "$last")   # 999999 if unknown: better one extra comment than none
    if [ "$age" -ge "$REPEAT_MINUTES" ]; then
      gh_write issue comment "$issue" --body "Still down. $details" \
        || echo "::error::Commenting on #$issue failed."
    else
      echo "#$issue is open; last update ${age} min ago, next comment after ${REPEAT_MINUTES} min."
    fi
  fi
  exit 1
}

RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"
# Sourcing the file (for tests) defines the functions without running main.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi

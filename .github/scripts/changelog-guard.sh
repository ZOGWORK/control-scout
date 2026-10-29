#!/usr/bin/env bash
# Changelog guard (AGENTS.md rule 4b): a pull request that changes the app (src/ or server/, test files aside)
# also changes CHANGELOG.md, unless it says it changes nothing a visitor sees, either with the `no-changelog`
# label or with "No user-visible change." in its description (the template's Screenshots claim; the template's
# own HTML comments don't count).
#
#   git diff --name-only HEAD^1 HEAD | PR_BODY=… PR_LABELS='["a","b"]' bash .github/scripts/changelog-guard.sh
#
# Reads the changed paths on stdin, one per line. Exits 0 to pass, 1 to fail with a message.
# Tests: bash .github/scripts/changelog-guard.test.sh (CI runs them).

set -uo pipefail

app=() changelog=0
while IFS= read -r f; do
  f=${f%$'\r'}
  [ -n "$f" ] || continue
  [ "$f" = CHANGELOG.md ] && changelog=1
  case $f in
    src/* | server/*) ;;
    *) continue ;;
  esac
  # Tests and their fixtures change nothing a visitor sees.
  case $f in
    *.test.ts | *.test.tsx | *.test.js | *.test.mjs | *.spec.ts | *.spec.tsx | */__tests__/* | */__snapshots__/* | src/test/* | server/test/*) continue ;;
  esac
  app+=("$f")
done

if [ ${#app[@]} -eq 0 ]; then echo "changelog guard: no app files changed"; exit 0; fi
if [ "$changelog" = 1 ]; then echo "changelog guard: CHANGELOG.md is updated"; exit 0; fi
if [[ ${PR_LABELS:-} == *'"no-changelog"'* ]]; then echo "changelog guard: labelled no-changelog"; exit 0; fi
body=$(printf '%s' "${PR_BODY:-}" | perl -0pe 's/<!--.*?-->//gs')
if [[ $body == *"No user-visible change."* ]]; then echo "changelog guard: the description says No user-visible change."; exit 0; fi

echo "::error title=CHANGELOG.md not updated::This PR changes the app (${#app[@]} file(s) under src/ or server/, e.g. ${app[0]}) but not CHANGELOG.md."
echo "Add the change to CHANGELOG.md (AGENTS.md rule 4b). If a visitor sees no difference, write \"No user-visible change.\" in the PR description or add the no-changelog label."
exit 1

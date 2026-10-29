#!/usr/bin/env bash
# Tests for changelog-guard.sh: `bash .github/scripts/changelog-guard.test.sh` (CI runs it).

set -uo pipefail
SCRIPT="$(cd "$(dirname "$0")" && pwd)/changelog-guard.sh"
PASS=0 FAIL=0

# check <name> <want exit> <files, newline separated> [body] [labels json]
check() {
  local name=$1 want=$2 files=$3 body=${4:-} labels=${5:-[]} got
  printf '%s\n' "$files" | PR_BODY="$body" PR_LABELS="$labels" bash "$SCRIPT" >/dev/null 2>&1
  got=$?
  if [ "$got" = "$want" ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "FAIL: $name (exit $got, want $want)"; fi
}

TEMPLATE='## Screenshots

<!-- Required for any user-visible change (AGENTS.md rules 5–6) …
     If nothing a user sees changes, replace this comment with: No user-visible change. -->'

check "app change without a changelog fails" 1 "src/pages/Home.tsx"
check "server change without a changelog fails" 1 "server/api/events.ts"
check "app change with the changelog passes" 0 $'src/pages/Home.tsx\nCHANGELOG.md'
check "tests only pass" 0 $'src/lib/format.test.ts\nserver/api/scoreSheet.test.ts\nsrc/components/Foo.test.tsx'
check "CI and docs only pass" 0 $'.github/workflows/ci.yml\nAGENTS.md\ndocs/notes.md\nscripts/perf.ts'
check "engine changes are rule 4's, not this guard's" 0 "packages/predict-engine/src/index.ts"
check "a test plus app code still fails" 1 $'src/lib/format.test.ts\nsrc/lib/format.ts'
check "the no-changelog label passes" 0 "src/pages/Home.tsx" "" '["bug","no-changelog"]'
check "another label doesn't" 1 "src/pages/Home.tsx" "" '["no-changelog-needed"]'
check "No user-visible change. in the body passes" 0 "server/db.ts" $'## Screenshots\n\nNo user-visible change.\n'
check "the template's own comment doesn't count" 1 "server/db.ts" "$TEMPLATE"
check "CRLF paths are read" 1 $'src/pages/Home.tsx\r'
check "CRLF changelog path counts" 0 $'src/pages/Home.tsx\r\nCHANGELOG.md\r'
check "no files pass" 0 ""

echo "changelog-guard: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]

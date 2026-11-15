#!/bin/sh
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LOOP_REPO=${TERRALOOP_REPO:-$HOME/.pi/agent/git/github.com/acoyfellow/terraloop-mode}
TARGET=${COMPLEX_TARGET:-prod}
LOG=$ROOT/.git/complex-gate
mkdir -p "$LOG"
cd "$ROOT" || exit 1
TSX=$ROOT/node_modules/.bin/tsx
failed=0

step() {
  name=$1
  shift
  if "$@" > "$LOG/$name.out" 2>&1; then
    echo "PASS $name"
  else
    echo "FAIL $name (see $LOG/$name.out)"
    failed=1
  fi
}

has_files() {
  for file in "$@"; do
    [ -s "$file" ] || { echo "missing $file"; return 1; }
  done
}

no_local_fakes() {
  for file in "$ROOT"/src/domain/*-store.test.ts "$ROOT"/src/domain/stores.test.ts "$ROOT"/src/domain/records.test.ts "$ROOT"/src/domain/prefs-push.test.ts; do
    if grep -q "function fakeDb" "$file"; then echo "$file still has its own fake"; return 1; fi
    grep -q 'from "./test-db"' "$file" || { echo "$file does not use test-db"; return 1; }
  done
}

step check npm run check
step item1-files has_files src/domain/refusals.ts migrations/0042_domain_refusals.sql
step item1-test "$TSX" --test src/domain/refusals.test.ts
step item2-file has_files verify/prod-write-probe.mjs
step item2-probe node verify/prod-write-probe.mjs "$TARGET"
step item3-file has_files verify/screen-check.mjs
step item3-screens node verify/screen-check.mjs "$TARGET"
step item4-files has_files src/domain/test-db.ts
step item4-shared no_local_fakes
step item4-test "$TSX" --test src/domain/test-db.test.ts src/domain/run-store.test.ts src/domain/session-store.test.ts src/domain/job-store.test.ts src/domain/recipe-store.test.ts src/domain/attention-store.test.ts src/domain/stores.test.ts src/domain/records.test.ts src/domain/prefs-push.test.ts
step item5-notes has_files "$LOOP_REPO/docs/misfires-2026-11.md"
step decision-inline node verify/decision-inline-check.mjs "$TARGET"

if [ "$failed" -eq 0 ]; then echo "complex gate: PASS ($TARGET)"; else echo "complex gate: FAIL ($TARGET)"; fi
exit "$failed"

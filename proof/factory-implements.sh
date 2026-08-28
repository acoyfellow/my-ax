#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== 1. unit: a stamp cannot open a ready PR =="
npx tsx --test agents/src/policy.test.ts agents/src/harness.test.ts >/tmp/factory-implements-unit.log 2>&1 \
  || { tail -20 /tmp/factory-implements-unit.log >&2; fail "factory unit tests do not pass"; }
echo "ok: stamp blocks ready PR; product files open it"

echo "== 2. live stamps #159 and #161 must not be the implementer contract =="
for PR in 159 161; do
  FILES="$(gh pr view "$PR" --repo acoyfellow/my-ax --json files --jq '[.files[].path] | join(" ")')"
  PRODUCT="$(printf '%s\n' $FILES | grep -v '^\.factory/' || true)"
  [ -z "$PRODUCT" ] || fail "PR $PR already has product files; this step asserts the historical stamp"
  echo "ok: PR $PR is still a stamp (audit must say needs-human)"
done

echo "== 3. source: implement step exists and refuses .factory-only heads =="
grep -q 'step: "implement"' agents/src/orchestrate.ts || fail "runTriage has no implement step"
grep -q 'productFilesOnBranch' agents/src/orchestrate.ts || fail "productFilesOnBranch missing"
grep -q 'blocked-stamp' agents/src/orchestrate.ts || fail "blocked-stamp stage missing"
echo "ok: implementer is in the graph"

echo
echo "PASS: factory will not call a .factory seed a ready PR."

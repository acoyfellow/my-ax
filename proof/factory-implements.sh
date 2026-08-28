#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== 1. unit: a stamp cannot open a ready PR =="
npx tsx --test agents/src/policy.test.ts agents/src/harness.test.ts >/tmp/factory-implements-unit.log 2>&1 \
  || { tail -20 /tmp/factory-implements-unit.log >&2; fail "factory unit tests do not pass"; }
echo "ok: stamp blocks ready PR; product files open it"

echo "== 2. at least one open ready PR has a product file =="
PRODUCT_PR=""
for PR in $(gh pr list --repo acoyfellow/my-ax --state open --limit 30 --json number --jq '.[].number'); do
  FILES="$(gh pr view "$PR" --repo acoyfellow/my-ax --json files --jq '[.files[].path] | join("\n")')"
  if printf '%s\n' "$FILES" | grep -qv '^\.factory/'; then
    PRODUCT_PR="$PR"
    break
  fi
done
[ -n "$PRODUCT_PR" ] || fail "no open PR has a non-.factory product file; implementer still only stamps"
echo "ok: PR $PRODUCT_PR has product files"

echo "== 3. source: implement step exists and refuses .factory-only heads =="
grep -q 'step: "implement"' agents/src/orchestrate.ts || fail "runTriage has no implement step"
grep -q 'productFilesOnBranch' agents/src/orchestrate.ts || fail "productFilesOnBranch missing"
grep -q 'blocked-stamp' agents/src/orchestrate.ts || fail "blocked-stamp stage missing"
echo "ok: implementer is in the graph"

echo
echo "PASS: factory will not call a .factory seed a ready PR."

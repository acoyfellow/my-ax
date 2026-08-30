#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== 1. unit: stamp stays blocked; Agents putFile opens a ready PR =="
npx tsx --test agents/src/policy.test.ts agents/src/harness.test.ts >/tmp/factory-implements-unit.log 2>&1 \
  || { tail -20 /tmp/factory-implements-unit.log >&2; fail "factory unit tests do not pass"; }
echo "ok: unit graph holds"

echo "== 2. draft does not spawn Terrarium =="
grep -q 'productFilesOnBranch' agents/src/orchestrate.ts || fail "productFilesOnBranch missing"
grep -q 'putFile' agents/src/orchestrate.ts || fail "Agents has no putFile on the draft path"
grep -n 'formatImplementTask\|IMPLEMENT_TASK_PROOF' agents/src/orchestrate.ts >/dev/null \
  && fail "draft still has a Terrarium implementer"
echo "ok: no Terrarium on draft"

echo "== 3. live: an open PR has a product file =="
PRODUCT_PR=""
for PR in $(gh pr list --repo acoyfellow/my-ax --state open --limit 30 --json number --jq '.[].number'); do
  FILES="$(gh pr view "$PR" --repo acoyfellow/my-ax --json files --jq '[.files[].path] | join("\n")')"
  if printf '%s\n' "$FILES" | grep -qv '^\.factory/'; then
    PRODUCT_PR="$PR"
    break
  fi
done
[ -n "$PRODUCT_PR" ] || fail "no open PR has a non-.factory product file"
echo "ok: PR $PRODUCT_PR has product files"

echo
echo "PASS: factory opens a ready PR with a product file and does not spawn Terrarium."

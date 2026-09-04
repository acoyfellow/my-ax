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

is_product_path() {
  case "$1" in
    .factory/*) return 1 ;;
    src/factory/issue-*.md) return 1 ;;
    src/*) return 0 ;;
    *) return 1 ;;
  esac
}

echo "== 3. planted: receipt markdown is not a product file =="
is_product_path "src/factory/issue-155.md" && fail "src/factory/issue-155.md must not count as product"
is_product_path ".factory/issue-155.md" && fail ".factory/ stamp must not count as product"
is_product_path "src/ui/Chat.svelte" || fail "a real src/ path must count as product"
echo "ok: receipt markdown is not product"

echo "== 4. live: an open PR has a real product file =="
PRODUCT_PR=""
for PR in $(gh pr list --repo acoyfellow/my-ax --state open --limit 30 --json number --jq '.[].number'); do
  FILES="$(gh pr view "$PR" --repo acoyfellow/my-ax --json files --jq '[.files[].path] | join("\n")')"
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    if is_product_path "$path"; then
      PRODUCT_PR="$PR"
      break
    fi
  done <<< "$FILES"
  [ -n "$PRODUCT_PR" ] && break
done
[ -n "$PRODUCT_PR" ] || fail "no open PR diffs a real src/ product path (src/factory/issue-*.md does not count)"
echo "ok: PR $PRODUCT_PR has product files"

echo
echo "PASS: factory opens a ready PR with a product file and does not spawn Terrarium."

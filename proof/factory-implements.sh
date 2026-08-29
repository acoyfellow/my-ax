#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== 1. unit: a stamp cannot open a ready PR =="
npx tsx --test agents/src/policy.test.ts agents/src/harness.test.ts >/tmp/factory-implements-unit.log 2>&1 \
  || { tail -20 /tmp/factory-implements-unit.log >&2; fail "factory unit tests do not pass"; }
echo "ok: stamp blocks ready PR; product files open it"

echo "== 2. draft does not spawn Terrarium and refuses .factory-only heads =="
grep -q 'productFilesOnBranch' agents/src/orchestrate.ts || fail "productFilesOnBranch missing"
grep -q 'blocked-stamp' agents/src/orchestrate.ts || fail "blocked-stamp stage missing"
grep -n 'formatImplementTask\|IMPLEMENT_TASK_PROOF' agents/src/orchestrate.ts >/dev/null \
  && fail "draft still has a Terrarium implementer"
echo "ok: draft lists the head and does not spawn Terrarium"

echo
echo "PASS: factory will not call a .factory seed a ready PR."

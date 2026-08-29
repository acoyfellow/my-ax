#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== 1. D1 user/assistant turns without uiMessageId survive Think replay =="
npx tsx --test src/ui/transcript-merge.test.ts >/tmp/transcript-parity-unit.log 2>&1 \
  || { tail -20 /tmp/transcript-parity-unit.log >&2; fail "transcript merge tests do not pass"; }
grep -q 'keepDurableTurn' src/ui/Chat.svelte \
  || fail "Chat.svelte still drops every d1- id on Think replay"
grep -q 'keepExistingOnlyIf: (m) => !m.id.startsWith("d1-")' src/ui/Chat.svelte \
  && fail "Chat.svelte still drops d1- user turns"
echo "ok: durable turns survive compacted Think replay"

echo "== 2. mutant: dropping d1- user rows must fail =="
cp src/ui/transcript-merge.ts /tmp/transcript-merge.bak
python3 - <<'PY'
from pathlib import Path
p = Path("src/ui/transcript-merge.ts")
s = p.read_text()
old = 'if (message.role === "user" || message.role === "assistant" || message.role === "error") return true;'
assert old in s, "anchor missing"
p.write_text(s.replace(old, "if (false) return true;", 1))
print("applied")
PY
set +e
npx tsx --test src/ui/transcript-merge.test.ts >/tmp/transcript-parity-mutant.log 2>&1
mut=$?
set -e
cp /tmp/transcript-merge.bak src/ui/transcript-merge.ts
[ "$mut" -ne 0 ] || fail "mutant survived: d1- user rows can still be dropped"
echo "ok: mutant caught"

echo
echo "PASS: phone and computer keep the same durable user/assistant turns after Think replay."

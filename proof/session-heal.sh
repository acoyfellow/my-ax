#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== 1. a foreign Think replay is rejected =="
npx tsx --test src/ui/transcript-merge.test.ts >/tmp/session-heal-unit.log 2>&1 \
  || { tail -20 /tmp/session-heal-unit.log >&2; fail "transcript merge tests do not pass"; }
grep -q 'thinkReplayLooksForeign' src/ui/Chat.svelte \
  || fail "Chat.svelte does not reject a foreign Think replay"
grep -q 'thinkMessages = \[\]' src/ui/Chat.svelte \
  || fail "Chat.svelte does not clear Think history on session switch"
grep -q 'boundToSession' src/ui/Chat.svelte \
  || fail "Chat.svelte does not stamp/filter rows by session"
grep -q 'dropHomelessThinkTurns' src/ui/Chat.svelte \
  || fail "Chat.svelte does not drop untimed Think-only turns"
echo "ok: switch clears Think; foreign replay restores D1; homeless Think turns drop"

echo "== 2. mutant: accepting a foreign replay must fail =="
cp src/ui/transcript-merge.ts /tmp/session-heal.bak
python3 - <<'PY'
from pathlib import Path
p = Path("src/ui/transcript-merge.ts")
s = p.read_text()
old = "if (existingUsers.length === 0 || incomingUsers.length < 2) return false;"
assert old in s, "anchor missing"
p.write_text(s.replace(old, "if (true) return false;", 1))
print("applied")
PY
set +e
npx tsx --test src/ui/transcript-merge.test.ts >/tmp/session-heal-mutant.log 2>&1
mut=$?
set -e
cp /tmp/session-heal.bak src/ui/transcript-merge.ts
[ "$mut" -ne 0 ] || fail "mutant survived: foreign replay is accepted"
echo "ok: mutant caught"

echo
echo "PASS: a session that receives another thread's replay heals from D1."

#!/usr/bin/env bash
set -euo pipefail

HOST="${MYAX_HOST:-}"
if [ -z "$HOST" ]; then
  ENV_FILE="${MYAX_ENV_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/my-ax-private/employee.env}"
  [ -r "$ENV_FILE" ] || { echo "FAIL: set MYAX_HOST, or provide $ENV_FILE with EMPLOYEE_ROUTE" >&2; exit 1; }
  ROUTE="$(sed -n 's/^EMPLOYEE_ROUTE=//p' "$ENV_FILE" | tr -d '"' | head -1)"
  [ -n "$ROUTE" ] || { echo "FAIL: EMPLOYEE_ROUTE missing from $ENV_FILE" >&2; exit 1; }
  HOST="https://$ROUTE"
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }

TOKEN="$(cloudflared access token --app="$HOST" 2>/dev/null || true)"
[ -n "$TOKEN" ] || fail "no Access token for $HOST; run: cloudflared access login $HOST"
api() { curl -s -H "cf-access-token: $TOKEN" --max-time 60 "$@"; }

echo "== 1. the top-bar terminal control is gone from source and the shipped bundle =="
grep -n 'id="terminal-button"' src/ui/AppShell.svelte >/dev/null \
  && fail "src/ui/AppShell.svelte still has id=terminal-button"
grep -n 'Workspace terminal' src/ui/AppShell.svelte >/dev/null \
  && fail "src/ui/AppShell.svelte still advertises a top-bar Workspace terminal"
BUNDLE_PATH="$(api "$HOST/" | grep -oE '/__svelte/beta\.[a-f0-9]+\.js' | head -1)"
[ -n "$BUNDLE_PATH" ] || fail "could not find the deployed svelte bundle"
api "$HOST$BUNDLE_PATH" -o /tmp/inline-bundle.js --max-time 90
grep -q 'id="terminal-button"' /tmp/inline-bundle.js \
  && fail "the deployed bundle still ships id=terminal-button"
grep -q 'Workspace terminal' /tmp/inline-bundle.js \
  && fail "the deployed bundle still ships a top-bar Workspace terminal"
echo "ok: no top-bar terminal button"

echo "== 2. chat hosts an inline terminal, not only a global dialog =="
grep -q 'inline-terminal\|InlineTerminal\|terminal-inline' src/ui/Chat.svelte src/ui/*.svelte 2>/dev/null \
  || fail "no inline terminal host in the chat UI"
echo "ok: chat has an inline terminal host"

echo "== 3. a resize is not sent until the host has a real width =="
grep -n 'terminalUrl(window.location.origin, 80, 24)' src/ui/Terminal.svelte >/dev/null \
  && fail "Terminal.svelte still connects at hardcoded 80x24"
echo "ok: the socket is not opened at a guessed size"

echo "== 4. recycle and gh still hold =="
bash proof/terminal-remainders.sh >/tmp/inline-remainders.log 2>&1 || {
  tail -12 /tmp/inline-remainders.log >&2
  fail "proof/terminal-remainders.sh no longer passes"
}
echo "ok: remainders still pass"

echo "== 5. the live pty still works =="
bash proof/terminal-live.sh >/tmp/inline-live.log 2>&1 || {
  tail -12 /tmp/inline-live.log >&2
  fail "proof/terminal-live.sh no longer passes"
}
echo "ok: the terminal gate still exits 0"

echo
echo "PASS: no top-bar terminal, inline host exists, size is measured, prior gates hold."

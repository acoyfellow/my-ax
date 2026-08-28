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

echo "== 1. chat does not mount a terminal on every load =="
grep -n '<Terminal />' src/ui/Chat.svelte >/dev/null \
  && fail "Chat.svelte still always-mounts <Terminal />"
grep -q '{#if terminalOpen}' src/ui/Chat.svelte \
  || fail "Chat.svelte does not gate the terminal behind terminalOpen"
grep -n 'id="terminal-button"' src/ui/AppShell.svelte >/dev/null \
  && fail "the top-bar terminal button came back"
echo "ok: no always-on terminal in chat or the shell"

echo "== 2. the shipped bundle matches =="
BUNDLE_PATH="$(api "$HOST/" | grep -oE '/__svelte/beta\.[a-f0-9]+\.js' | head -1)"
[ -n "$BUNDLE_PATH" ] || fail "could not find the deployed svelte bundle"
api "$HOST$BUNDLE_PATH" -o /tmp/ondemand-bundle.js --max-time 90
grep -q 'id="terminal-button"' /tmp/ondemand-bundle.js \
  && fail "the deployed bundle still ships id=terminal-button"
grep -q 'data-on-demand' /tmp/ondemand-bundle.js \
  || fail "the deployed bundle has no on-demand terminal card"
grep -q 'my-ax:terminal-open' /tmp/ondemand-bundle.js \
  || fail "the deployed bundle has no explicit terminal-open event"
echo "ok: deployed UI is on-demand"

echo "== 3. an empty live chrome is not treated as ready =="
grep -q 'waiting' src/ui/Terminal.svelte \
  || fail "Terminal.svelte still labels an unpainted socket as live"
echo "ok: live requires painted bytes"

echo "== 4. unit invariants =="
npm run --silent test:terminal >/dev/null 2>&1 || fail "terminal unit tests do not pass"
echo "ok: unit invariants hold"

echo
echo "PASS: terminals are on-demand cards, not a permanent chat strip."

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

echo "== 1. the wire protocol invariants hold in unit form =="
npm run --silent test:terminal >/dev/null 2>&1 || fail "terminal unit invariants do not pass"
echo "ok: unit invariants hold"

TOKEN="$(cloudflared access token --app="$HOST" 2>/dev/null || true)"
[ -n "$TOKEN" ] || fail "no Access token for $HOST; run: cloudflared access login $HOST"
api() { curl -s -H "cf-access-token: $TOKEN" --max-time 60 "$@"; }

echo "== 2. the deployed worker serves a pty on the owner container =="
PROBE="$(api "$HOST/api/workspace/terminal-probe")"
echo "$PROBE" | grep -q '"hasTerminal":true' || fail "deployed sandbox exposes no terminal method: $PROBE"
echo "$PROBE" | grep -q '"ptyStatus":101' || fail "pty did not answer 101 switching protocols: $PROBE"
echo "$PROBE" | grep -q '"ptyHasWebSocket":true' || fail "pty answered 101 with no websocket: $PROBE"
echo "ok: pty upgrade reaches a live container"

echo "== 3. a non-upgrade request is refused instead of hanging =="
CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "cf-access-token: $TOKEN" --max-time 45 "$HOST/api/workspace/terminal")"
[ "$CODE" = "426" ] || fail "plain GET on the terminal answered $CODE, expected 426"
echo "ok: plain GET answers 426"

echo "== 4. the terminal is Access gated =="
for BAD in "" "not-a-real-token"; do
  if [ -z "$BAD" ]; then
    OUT="$(curl -s -o /dev/null -w '%{http_code}' --max-time 45 "$HOST/api/workspace/terminal")"
  else
    OUT="$(curl -s -o /dev/null -w '%{http_code}' -H "cf-access-token: $BAD" --max-time 45 "$HOST/api/workspace/terminal")"
  fi
  case "$OUT" in
    200|101|426) fail "the terminal answered $OUT without a valid Access token" ;;
  esac
done
echo "ok: an unauthenticated upgrade never reaches the pty"

echo "== 5. a typed command round-trips, survives a reconnect, and never leaks =="
CANARY="ptygate_$(date +%s)_$RANDOM"
MYAX_HOST="$HOST" MYAX_TOKEN="$TOKEN" MYAX_CANARY="$CANARY" \
  node proof/terminal-live-client.mjs || fail "the live pty client did not prove typing, reconnect, and resize"
echo "ok: typed input executes, shell state survives a reconnect"

echo "== 6. terminal bytes never reach the error queue or a transcript =="
sleep 4
ERRORS="$(api "$HOST/api/errors?limit=50" || true)"
case "$ERRORS" in
  *"$CANARY"*) fail "terminal output leaked into the error queue" ;;
esac
SESSIONS="$(api "$HOST/api/sessions?limit=12" || true)"
for SID in $(printf '%s' "$SESSIONS" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -12); do
  ENTRIES="$(api "$HOST/api/sessions/$SID/entries?limit=50" || true)"
  case "$ENTRIES" in
    *"$CANARY"*) fail "terminal output leaked into transcript $SID" ;;
  esac
done
echo "ok: terminal bytes stay out of the transcript and the error queue"

echo
echo "PASS: the deployed worker serves a real pty, typed input executes, the"
echo "session survives a reconnect, the door is Access gated, and terminal"
echo "bytes never reach the transcript or the error queue."

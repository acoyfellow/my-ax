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

echo "== 1. the live path, the theme, and the bridge hold in unit form =="
npm run --silent test:desk-app >/dev/null 2>&1 || fail "desk app unit invariants do not pass"
echo "ok: unit invariants hold"

TOKEN="$(cloudflared access token --app="$HOST" 2>/dev/null || true)"
[ -n "$TOKEN" ] || fail "no Access token for $HOST; run: cloudflared access login $HOST"
api() { curl -s -H "cf-access-token: $TOKEN" --max-time 45 "$@"; }

echo "== 2. a write to the desk app broadcasts instead of stopping at the database =="
grep -q 'broadcastDeskApp' src/routes/desk.ts || fail "the desk app write path does not broadcast; a write nobody sees is not live"
grep -q 'this.broadcast(frame)' src/user-agent.ts || fail "the owner root does not broadcast to owner-level clients"
grep -q 'm.type === "desk.app"' src/ui/Chat.svelte || fail "the client does not route the live desk frame"
grep -q 'addEventListener("my-ax:desk-app"' src/ui/Desk.svelte || fail "the desk does not listen for its own live frame"
echo "ok: the live push path is wired end to end"

echo "== 3. the deployed shell ships the design system, not browser defaults =="
APPID="$(api "$HOST/api/desk/app" | sed -n 's/.*"artifactId":"\([^"]*\)".*/\1/p')"
if [ -z "$APPID" ]; then
  APPID="$(api "$HOST/api/artifacts?limit=25" | tr ',' '\n' | sed -n 's/.*"id":"\([0-9a-f-]\{36\}\)".*/\1/p' | head -1)"
  [ -n "$APPID" ] || fail "no artifact available to host on the desk"
  api "$HOST/api/desk/app" -X PUT -H 'content-type: application/json' -d "{\"artifactId\":\"$APPID\"}" >/dev/null
fi
PREVIEW="$(api "$HOST/api/artifacts/$APPID/preview")"
printf '%s' "$PREVIEW" | grep -q -- '--brand: #f6821f' || fail "the served shell has no brand token; an agent cannot style anything"
printf '%s' "$PREVIEW" | grep -q 'button, .btn' || fail "the served shell does not style buttons"
printf '%s' "$PREVIEW" | grep -qE 'input, textarea, select' || fail "the served shell does not style form controls"
printf '%s' "$PREVIEW" | grep -q 'data-theme="light"' || fail "the served shell has no light theme"
printf '%s' "$PREVIEW" | grep -q 'my-ax:artifact-theme' || fail "the shell cannot follow the owner theme"
echo "ok: tokens, controls, and both themes are served"

echo "== 4. the hosted app really calls the app, and renders real data =="
printf '%s' "$PREVIEW" | grep -q 'window.myax' || fail "the hosted app has no outbound bridge"
for verb in listSessions deskWrite; do
  printf '%s' "$PREVIEW" | grep -q "$verb" || fail "the hosted desk app never calls $verb"
done
SESSIONS="$(api "$HOST/api/sessions?limit=3")"
printf '%s' "$SESSIONS" | grep -q '"name"' || fail "/api/sessions no longer returns name; the title mapping needs review"
grep -q 's.title ?? s.name' src/ui/page-registry.ts || fail "listSessions does not fall back to name, so every desk row renders an em-dash"
echo "ok: the app calls real verbs and titles resolve"

echo "== 5. a live write round-trips through the deployed worker =="
MARK="live-$RANDOM"
api "$HOST/api/desk/app" -X PUT -H 'content-type: application/json' \
  -d "{\"state\":{\"notes\":[{\"id\":\"$MARK\",\"text\":\"pushed by the gate\",\"done\":false}]},\"updatedBy\":\"gate\"}" >/dev/null
READBACK="$(api "$HOST/api/desk/app")"
printf '%s' "$READBACK" | grep -q "$MARK" || fail "a desk write did not survive a read"
echo "ok: a write reaches the desk state every client reads"

echo "== 6. concurrent writers still do not clobber =="
A="cw-a-$RANDOM"
api "$HOST/api/desk/app" -X PUT -H 'content-type: application/json' -d "{\"state\":{\"marker\":\"$A\"},\"updatedBy\":\"agent-a\"}" -o /dev/null &
api "$HOST/api/desk/app" -X PUT -H 'content-type: application/json' -d "{\"artifactId\":\"$APPID\",\"updatedBy\":\"agent-b\"}" -o /dev/null &
wait
BOTH="$(api "$HOST/api/desk/app")"
printf '%s' "$BOTH" | grep -q "\"artifactId\":\"$APPID\"" || fail "a concurrent write lost the hosted app reference"
echo "ok: concurrent writers survive"

echo "== 7. none of this widened the sandbox =="
HEADERS="$(curl -s -D- -o /dev/null -H "cf-access-token: $TOKEN" --max-time 45 "$HOST/api/artifacts/$APPID/preview")"
printf '%s' "$HEADERS" | grep -qi "default-src 'none'" || fail "the artifact CSP no longer starts from default-src none"
printf '%s' "$HEADERS" | grep -qi "cdn\." && fail "the CSP now allows a third-party cdn"
grep -q 'sandbox="allow-scripts"' src/ui/Desk.svelte || fail "the desk frame is not sandbox=allow-scripts"
if grep -q 'allow-same-origin' src/ui/Desk.svelte; then fail "the desk frame was granted same-origin access"; fi
if grep -qE '@import|https?://' src/artifact-theme.ts; then fail "the theme pulls a remote stylesheet"; fi
echo "ok: the desk app still runs with no owner credentials"

echo
echo "PASS: the desk is a styled agent-authored app that updates live in both directions"

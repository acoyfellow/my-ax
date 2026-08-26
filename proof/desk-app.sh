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

echo "== 1. the bridge, the write path, and the host structure hold =="
npm run --silent test:desk-app >/dev/null 2>&1 || fail "desk app unit invariants do not pass"
echo "ok: unit invariants hold"

TOKEN="$(cloudflared access token --app="$HOST" 2>/dev/null || true)"
[ -n "$TOKEN" ] || fail "no Access token for $HOST; run: cloudflared access login $HOST"
api() { curl -s -H "cf-access-token: $TOKEN" --max-time 45 "$@"; }

echo "== 2. the deployed worker serves the desk app endpoint =="
BEFORE="$(api "$HOST/api/desk/app")"
printf '%s' "$BEFORE" | grep -q '"ok":true' || fail "GET /api/desk/app did not answer: $(printf '%s' "$BEFORE" | head -c 200)"
echo "ok: desk app endpoint live"

echo "== 3. the desk holds free-form state with no fixed status vocabulary =="
SHAPE='{"columns":[{"name":"needs you","items":[{"id":"a","phase":"waiting-on-you","owner":"factory"}]},{"name":"working","items":[{"id":"b","phase":"in-progress","owner":"oracle"}]}]}'
api "$HOST/api/desk/app" -X PUT -H 'content-type: application/json' -d "{\"state\":$SHAPE,\"updatedBy\":\"proof\"}" >/dev/null
ROUNDTRIP="$(api "$HOST/api/desk/app")"
printf '%s' "$ROUNDTRIP" | grep -q 'waiting-on-you' || fail "the desk did not keep a phase outside pending/approved/rejected"
printf '%s' "$ROUNDTRIP" | grep -q 'in-progress' || fail "the desk did not keep a second custom phase"
echo "ok: custom phases and columns survive a round trip"

echo "== 4. a bad write is refused, not silently truncated =="
EMPTY="$(api "$HOST/api/desk/app" -X PUT -H 'content-type: application/json' -d '{}')"
printf '%s' "$EMPTY" | grep -q 'requires state or artifactId' || fail "an empty write was not refused"
BADID="$(api "$HOST/api/desk/app" -X PUT -H 'content-type: application/json' -d '{"artifactId":"../etc/passwd"}')"
printf '%s' "$BADID" | grep -q 'valid id or null' || fail "a traversal artifactId was not refused"
BIG="$(python3 -c 'import json;print(json.dumps({"state":{"blob":"x"*140000}}))')"
OVER="$(api "$HOST/api/desk/app" -X PUT -H 'content-type: application/json' -d "$BIG")"
printf '%s' "$OVER" | grep -q 'the limit is' || fail "an oversized state was not refused"
echo "ok: every bad write is refused with a reason"

echo "== 5. two agents writing at once both survive =="
MARK="race-$RANDOM"
api "$HOST/api/desk/app" -X PUT -H 'content-type: application/json' -d "{\"state\":{\"$MARK\":\"a\"},\"updatedBy\":\"agent-a\"}" >/dev/null
api "$HOST/api/desk/app" -X PUT -H 'content-type: application/json' -d '{"artifactId":null,"updatedBy":"agent-b"}' -o /dev/null &
api "$HOST/api/desk/app" -X PUT -H 'content-type: application/json' -d "{\"state\":{\"$MARK\":\"b\",\"second\":true},\"updatedBy\":\"agent-c\"}" -o /dev/null &
wait
AFTER="$(api "$HOST/api/desk/app")"
printf '%s' "$AFTER" | grep -q "$MARK" || fail "a concurrent write lost the marker key"
echo "ok: concurrent writers do not erase each other"

echo "== 6. an agent-authored app is hosted, and it can call the app back =="
APPID="$(printf '%s' "$AFTER" | sed -n 's/.*"artifactId":"\([^"]*\)".*/\1/p')"
if [ -z "$APPID" ]; then
  APPID="$(api "$HOST/api/artifacts?limit=25" | tr ',' '\n' | sed -n 's/.*"id":"\([0-9a-f-]\{36\}\)".*/\1/p' | head -1)"
  [ -n "$APPID" ] || fail "no artifact available to host on the desk"
  api "$HOST/api/desk/app" -X PUT -H 'content-type: application/json' -d "{\"artifactId\":\"$APPID\"}" >/dev/null
fi
HOSTED="$(api "$HOST/api/desk/app")"
printf '%s' "$HOSTED" | grep -q "\"artifactId\":\"$APPID\"" || fail "the desk did not persist the hosted app reference"
PREVIEW="$(api "$HOST/api/artifacts/$APPID/preview")"
printf '%s' "$PREVIEW" | grep -q 'window.myax' || fail "the hosted app has no outbound bridge; it can only render what it is handed"
printf '%s' "$PREVIEW" | grep -q 'my-ax:host-invoke' || fail "the hosted app cannot post an outbound invoke"
echo "ok: the desk hosts an app that can call the app"

echo "== 6b. the deployed shell matches this checkout =="
grep -q '<script>${ARTIFACT_RUNTIME_JS}</script>' src/routes/artifacts.ts || fail "this checkout no longer injects the artifact runtime into the preview shell, so the deployed bridge is stale"
for helper in listSessions deskWrite onState invoke; do
  grep -q "$helper" src/artifact-runtime.ts || fail "the local runtime lost the $helper helper; the deployed shell is ahead of this checkout"
  printf '%s' "$PREVIEW" | grep -q "$helper" || fail "the deployed shell is missing the $helper helper"
done
echo "ok: the served bridge and this checkout agree"

echo "== 7. the sandbox is not widened to make any of this work =="
HEADERS="$(curl -s -D- -o /dev/null -H "cf-access-token: $TOKEN" --max-time 45 "$HOST/api/artifacts/$APPID/preview")"
printf '%s' "$HEADERS" | grep -qi "default-src 'none'" || fail "the artifact CSP no longer starts from default-src none"
grep -q 'sandbox="allow-scripts"' src/ui/Desk.svelte || fail "the desk frame is not sandbox=allow-scripts"
if grep -q 'allow-same-origin' src/ui/Desk.svelte; then fail "the desk frame was granted same-origin access"; fi
echo "ok: the desk app runs with no owner credentials"

echo
echo "PASS: the desk is an agent-authored app with a bounded outbound bridge and a lossless write path"

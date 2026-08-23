#!/usr/bin/env bash
set -euo pipefail

ORIGIN="${AGENTCAST_URL:-https://api.agentcast.dev}"
KEY="${AGENTCAST_ISSUER_KEY:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION=""
WORK="$(mktemp -d)"

log() { printf '[agentcast] %s\n' "$*" >&2; }
fail() { printf '[agentcast][FAIL] %s\n' "$*" >&2; exit 1; }

cleanup() {
  set +e
  if [ -n "$SESSION" ]; then
    TOKEN="$(mint "$SESSION" 2>/dev/null)"
    [ -n "$TOKEN" ] && curl -s -o /dev/null -X POST "$ORIGIN/api/session/$SESSION/stop" \
      -H "authorization: Bearer $TOKEN" --max-time 30
    log "stopped session"
  fi
  rm -rf "$WORK"
  set -e
}
trap cleanup EXIT

mint() {
  local sid="$1"
  curl -s -X POST "$ORIGIN/internal/capabilities" \
    -H "authorization: Bearer $KEY" -H "content-type: application/json" \
    -d "{\"tenantId\":\"owner\",\"sessionId\":\"$sid\",\"profileId\":\"my-ax\",\"permissions\":[\"sessions:create\",\"session:observe\",\"session:input\",\"session:control\",\"cdp:full\",\"network:record\",\"network:receipt\"],\"audience\":\"$ORIGIN\",\"ttlMs\":300000}" \
    --max-time 30 | jq -r '.token // empty'
}

call() {
  local method="$1" path="$2" sid="$3" body="${4:-}"
  local token; token="$(mint "$sid")"
  [ -n "$token" ] || fail "could not mint a capability"
  if [ -n "$body" ]; then
    curl -s -X "$method" "$ORIGIN$path" -H "authorization: Bearer $token" \
      -H "content-type: application/json" -d "$body" --max-time 60
  else
    curl -s -X "$method" "$ORIGIN$path" -H "authorization: Bearer $token" --max-time 60
  fi
}

[ -n "$KEY" ] || fail "AGENTCAST_ISSUER_KEY is required; this gate calls the live service"
command -v jq >/dev/null || fail "jq is required"

log "opening a live session on $ORIGIN"
CREATED="$(call POST /api/session '*' '{"name":"my-ax-gate"}')"
SESSION="$(printf '%s' "$CREATED" | jq -r '.data.sessionId // .sessionId // empty')"
[ -n "$SESSION" ] || fail "create did not return a session id"
log "PROVEN: a session was created"

READY=""
for _ in $(seq 1 120); do
  STATUS="$(call GET "/api/session/$SESSION" "$SESSION" | jq -r '.status // empty')"
  case "$STATUS" in
    ready|active) READY="$STATUS"; break ;;
    error) fail "the session reported an error while starting" ;;
  esac
  sleep 1
done
[ -n "$READY" ] || fail "the session was not ready in time"
log "PROVEN: the session reached $READY"

call POST "/api/session/$SESSION/wake" "$SESSION" >/dev/null
TICKET="$(call POST "/api/session/$SESSION/view-ticket" "$SESSION" | jq -r '.ticketUrl // empty')"
case "$TICKET" in
  https://*/ticket/*) : ;;
  *) fail "the viewer ticket is not a production ticket URL" ;;
esac
printf '%s' "$TICKET" | grep -q '.workers.dev' && fail "the viewer ticket points at workers.dev"
log "PROVEN: a production viewer ticket was issued"

call POST "/api/session/$SESSION/instruction" "$SESSION" '{"instruction":"goto https://example.com"}' >/dev/null
log "PROVEN: the session accepted an instruction"

call POST "/api/session/$SESSION/network-har/start" "$SESSION" '{"maxDurationMs":8000,"maxEntries":20}' >/dev/null
call POST "/api/session/$SESSION/instruction" "$SESSION" '{"instruction":"goto https://example.com/?gate=secret-probe-value"}' >/dev/null
sleep 3
call POST "/api/session/$SESSION/network-har/stop" "$SESSION" > "$WORK/receipt.json"
RECEIPT="$WORK/receipt.json"
jq -e '.receipt' "$RECEIPT" >/dev/null 2>&1 || fail "stop did not return a receipt"
log "PROVEN: a HAR capture produced a receipt"

grep -qi 'secret-probe-value' "$RECEIPT" && fail "the receipt leaked a query string"
grep -qiE '"(cookie|set-cookie|authorization)"' "$RECEIPT" && fail "the receipt leaked a forbidden header"
jq -e '[.. | strings | select(test("^https?://[^\\s]*[?#]"))] | length == 0' "$RECEIPT" >/dev/null 2>&1 \
  || fail "the receipt carries a URL with a query string or fragment; URLs must be origin only"
jq -e '[.. | objects | select(has("url") or has("headers") or has("request") or has("response") or has("postData") or has("content"))] | length == 0' "$RECEIPT" >/dev/null 2>&1 \
  || fail "the receipt carries a raw HAR shape; a receipt entry has origin and hostname, never url, headers, or bodies"
jq -e '[.receipt.entries // [] | .[] | select((.origin | type) != "string" or (.hostname | type) != "string")] | length == 0' "$RECEIPT" >/dev/null 2>&1 \
  || fail "a receipt entry is missing the redacted origin and hostname fields"
log "PROVEN: the receipt is redacted, with origin only entries and no header, body, or URL leak"

call POST "/api/session/$SESSION/stop" "$SESSION" >/dev/null
GONE="$(call GET "/api/session/$SESSION" "$SESSION" | jq -r '.status // "gone"')"
case "$GONE" in
  ready|active) fail "the session is still running after stop" ;;
esac
SESSION=""
log "PROVEN: stop freed the session"

cd "$ROOT"
git fetch origin main --quiet
MAIN="$(git rev-parse origin/main)"
DEPLOYED="$("$ROOT/node_modules/.bin/wrangler" deployments list --name my-ax 2>/dev/null | grep -c "$(git rev-parse --short origin/main)" || true)"
log "main is $MAIN"

npm run check >"$WORK/check.log" 2>&1 || fail "npm run check failed"
log "PROVEN: npm run check exits 0"

printf '\n# pass agentcast-live: open, instruct, redacted receipt, stop, all against the live service\n'

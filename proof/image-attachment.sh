#!/usr/bin/env bash
set -euo pipefail

HOST="${MYAX_HOST:-}"
if [ -z "$HOST" ]; then
  ENV_FILE="${MYAX_ENV_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/my-ax-private/employee.env}"
  [ -r "$ENV_FILE" ] || { echo "FAIL: set MYAX_HOST, or provide $ENV_FILE with EMPLOYEE_ROUTE" >&2; exit 1; }
  ROUTE="$(sed -n 's/^EMPLOYEE_ROUTE=//p' "$ENV_FILE" | tr -d '\"' | head -1)"
  [ -n "$ROUTE" ] || { echo "FAIL: EMPLOYEE_ROUTE missing from $ENV_FILE" >&2; exit 1; }
  HOST="https://$ROUTE"
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== 1. no submit path builds a file part with a relative upload url =="
npm run --silent test:image-attachment >/dev/null 2>&1 || fail "image attachment unit tests do not pass"
echo "ok: unit invariants hold"

echo "== 2. the deployed worker answers =="
TOKEN="$(cloudflared access token --app="$HOST" 2>/dev/null || true)"
[ -n "$TOKEN" ] || fail "no Access token for $HOST; run: cloudflared access login $HOST"
HEALTH="$(curl -s -o /dev/null -w '%{http_code}' "$HOST/api/health" -H "cf-access-token: $TOKEN" --max-time 30)"
[ "$HEALTH" = "200" ] || fail "GET /api/health returned $HEALTH"
echo "ok: health 200"

echo "== 3. the deployed bundle carries the fixed submit shape =="
DOC="$(curl -s "$HOST/" -H "cf-access-token: $TOKEN" --max-time 30)"
[ -n "$DOC" ] || fail "the served document was empty"
CHAT_CHUNKS="$(printf '%s' "$DOC" | grep -oE '/__svelte/[A-Za-z0-9_.-]+\.js' | sort -u)"
[ -n "$CHAT_CHUNKS" ] || fail "could not find any /__svelte/*.js chunk in the served document"
CHUNK_DIR="$(mktemp -d /tmp/proof-chunks-XXXXXX)"
trap 'rm -rf "$CHUNK_DIR"' EXIT
for chunk in $CHAT_CHUNKS; do
  curl -s "$HOST$chunk" -H "cf-access-token: $TOKEN" --max-time 60 -o "$CHUNK_DIR/$(basename "$chunk")"
done
if LC_ALL=C grep -rqE 'type:"file",url:"/api/uploads/' "$CHUNK_DIR"; then
  fail "a deployed chunk still builds a file part with a relative upload url (the crash shape)"
fi
LC_ALL=C grep -rq 'data-attachment' "$CHUNK_DIR" || fail "no deployed chunk carries a data-attachment part; attachments cannot be sent"
echo "ok: deployed chunks carry data-attachment and no relative file-part url"

echo "== 4. an upload round-trips =="
PNG="$(mktemp /tmp/proof-image-XXXXXX.png)"
printf '\x89PNG\r\n\x1a\n' > "$PNG"
dd if=/dev/urandom bs=256 count=1 >> "$PNG" 2>/dev/null
UPLOAD="$(curl -s "$HOST/api/uploads" -H "cf-access-token: $TOKEN" -F "file=@$PNG;type=image/png" --max-time 60 || true)"
rm -f "$PNG"
echo "$UPLOAD" | grep -q '"key"' || fail "POST /api/uploads did not return a key: $(printf '%s' "$UPLOAD" | head -c 200)"
KEY="$(printf '%s' "$UPLOAD" | sed -n 's/.*"key":"\([^"]*\)".*/\1/p')"
[ -n "$KEY" ] || fail "could not parse the upload key"
FETCHED="$(curl -s -o /dev/null -w '%{http_code}' "$HOST/api/uploads/$KEY" -H "cf-access-token: $TOKEN" --max-time 30)"
[ "$FETCHED" = "200" ] || fail "GET /api/uploads/<key> returned $FETCHED"
echo "ok: upload stored and readable"

echo
echo "PASS: image attachments can be sent; no relative file-part url reaches the model SDK"

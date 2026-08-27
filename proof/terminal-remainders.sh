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

echo "== 1. both session verbs accept either key =="
npm run --silent test:page-registry >/dev/null 2>&1 || fail "the page verb contract tests do not pass"
echo "ok: switchSession and sendToSession take {id} or {sessionId}"

echo "== 2. the shipped bundle carries the fixed contract, not the old error =="
BUNDLE_PATH="$(api "$HOST/" | grep -oE '/__svelte/beta\.[a-f0-9]+\.js' | head -1)"
[ -n "$BUNDLE_PATH" ] || fail "could not find the deployed svelte bundle"
api "$HOST$BUNDLE_PATH" -o /tmp/remainder-bundle.js --max-time 90
grep -q 'requires {id} or {sessionId}' /tmp/remainder-bundle.js \
  || fail "the deployed bundle does not carry the widened session contract"
grep -q 'requires {id}"' /tmp/remainder-bundle.js \
  && fail "the deployed bundle still carries the id-only error the desk hit"
echo "ok: the deployed desk accepts the shape its app actually sends"

echo "== 3. the spike debris routes are gone, and recycle survives =="
for PROBE in terminal-probe restore-probe transport-probe; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "cf-access-token: $TOKEN" --max-time 45 "$HOST/api/workspace/$PROBE")"
  [ "$CODE" = "404" ] || fail "$PROBE answered $CODE, expected 404 after deletion"
done
grep -q "terminal-probe\|restore-probe\|transport-probe" src/routes/terminal.ts \
  && fail "a debris probe route is still in the source"
RECYCLE="$(curl -s -X POST -H "cf-access-token: $TOKEN" --max-time 120 "$HOST/api/workspace/recycle")"
echo "$RECYCLE" | grep -q '"recheck"' || fail "the recycle route no longer works: $RECYCLE"
echo "ok: probes 404, recycle still recovers a container"

echo "== 4. gh is baked into the image and survives a recycle =="
grep -q "sha256sum -c" Dockerfile || fail "the gh install is not checksum verified"
MYAX_HOST="$HOST" MYAX_TOKEN="$TOKEN" node proof/terminal-gh-probe.mjs \
  || fail "gh is not available in a freshly recycled container"
echo "ok: gh --version works with no manual install"

echo "== 5. cloudterm renders bracketed paste with no visible escape =="
CLOUDTERM_PIN="$(node -p 'require("./package.json").dependencies.cloudterm')"
CLOUDTERM_PATCH="$(printf '%s' "$CLOUDTERM_PIN" | sed -n 's/.*#v0\.0\.\([0-9][0-9]*\).*/\1/p')"
[ -n "$CLOUDTERM_PATCH" ] && [ "$CLOUDTERM_PATCH" -ge 9 ] \
  || fail "cloudterm must be at least v0.0.9 to parse DEC private modes, found $CLOUDTERM_PIN"
if curl -s --max-time 5 "${CDP_URL:-http://127.0.0.1:19222}/json/version" >/dev/null 2>&1; then
  npx esbuild node_modules/cloudterm/dist/index.js --bundle --format=esm --outfile=/tmp/cloudterm-bundle.js --log-level=error >/dev/null 2>&1 \
    || fail "could not bundle cloudterm"
  MYAX_HOST="$HOST" MYAX_TOKEN="$TOKEN" CLOUDTERM_BUNDLE=/tmp/cloudterm-bundle.js \
    node proof/terminal-paste-proof.mjs || fail "a bracketed paste escape leaked into the rendered text"
else
  fail "no browser on ${CDP_URL:-http://127.0.0.1:19222}; the rendered outcome cannot be proven without one"
fi

echo "== 6. the terminal itself did not regress =="
bash proof/terminal-live.sh >/tmp/remainder-live.log 2>&1 || {
  tail -20 /tmp/remainder-live.log >&2
  fail "proof/terminal-live.sh no longer passes"
}
echo "ok: the terminal gate still exits 0"

echo
echo "PASS: the desk Open button works, the spike debris is gone, gh survives a"
echo "recycle, bracketed paste renders clean, and the terminal still passes."

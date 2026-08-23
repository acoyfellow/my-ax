#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PREVIEW_ENV_FILE:-$(cd "$ROOT/.." && pwd)/my-ax-private/employee.env}"
if [ -z "${EMPLOYEE_ROUTE:-}" ] && [ -r "$ENV_FILE" ]; then
  EMPLOYEE_ROUTE="$(sed -n 's/^EMPLOYEE_ROUTE=//p' "$ENV_FILE" | tail -1)"
fi

ROUTE="${EMPLOYEE_ROUTE:-}"
PR="${PR:-}"

log() { printf '[preview] %s\n' "$*" >&2; }
fail() { printf '[preview][FAIL] %s\n' "$*" >&2; exit 1; }

[ -n "$ROUTE" ] || fail "EMPLOYEE_ROUTE is required; export it or put it in $ENV_FILE"
command -v jq >/dev/null || fail "jq is required"
command -v gh >/dev/null || fail "gh is required"
command -v cloudflared >/dev/null || fail "cloudflared is required to reach an Access protected host"

if [ -z "$PR" ]; then
  PR="$(gh pr list --state open --json number --jq '.[0].number // empty' 2>/dev/null || true)"
  [ -n "$PR" ] || fail "no open pull request to verify; open one or set PR=<number>"
fi
case "$PR" in ''|*[!0-9]*) fail "PR must be a positive integer" ;; esac

HOST="pr-${PR}.${ROUTE}"
BASE="https://$HOST"
log "verifying PR #$PR against its own preview deploy"

HEAD_SHA="$(gh pr view "$PR" --json headRefOid --jq .headRefOid 2>/dev/null || true)"
[ -n "$HEAD_SHA" ] || fail "cannot read the head SHA for PR #$PR"
log "PR #$PR head is ${HEAD_SHA:0:7}"

if ! dig +short "$HOST" | head -1 | grep -q .; then
  fail "$HOST does not resolve; deploy the PR head with deploy-preview.sh first"
fi

UNAUTH="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health" --max-time 30 || true)"
case "$UNAUTH" in
  200) fail "$HOST served an unauthenticated request; a preview must sit behind Access" ;;
  000) fail "$HOST did not answer at all" ;;
  *) log "PROVEN: an unauthenticated request is refused ($UNAUTH)" ;;
esac

TOKEN="$(cloudflared access token --app "$BASE" 2>/dev/null | tail -1 || true)"
[ -n "$TOKEN" ] && [ "${#TOKEN}" -gt 40 ] || fail "no Access token for $BASE; run: cloudflared access login $BASE"

CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health" -H "cf-access-token: $TOKEN" --max-time 40 || true)"
[ "$CODE" = "200" ] || fail "$HOST answered $CODE through Access, not 200"
log "PROVEN: the preview answers 200 through Access"

SYSTEM="$(curl -s "$BASE/api/system" -H "cf-access-token: $TOKEN" --max-time 40 || true)"
DEPLOYED="$(printf '%s' "$SYSTEM" | jq -r '.deploy.commit // .commit // .version // empty' 2>/dev/null || true)"
[ -n "$DEPLOYED" ] || fail "the preview did not report a deployed commit"
case "$HEAD_SHA" in
  "$DEPLOYED"*) log "PROVEN: the preview runs this PR head (${DEPLOYED:0:7})" ;;
  *) case "$DEPLOYED" in
       "${HEAD_SHA:0:7}"*) log "PROVEN: the preview runs this PR head (${DEPLOYED:0:7})" ;;
       *) fail "the preview runs ${DEPLOYED:0:7} but PR #$PR head is ${HEAD_SHA:0:7}" ;;
     esac ;;
esac

node "$ROOT/scripts/verify-preview-isolation.mjs" preview >/dev/null 2>&1 \
  || fail "env.preview is not isolated from production data"
PROD_DB="$(node -e '
const {parse}=require("jsonc-parser");
const c=parse(require("fs").readFileSync(process.argv[1],"utf8"),[],{allowTrailingComma:true});
process.stdout.write((c.d1_databases||[]).map(d=>d.database_name).join(","));
' "$ROOT/wrangler.jsonc")"
PREVIEW_DB="$(node -e '
const {parse}=require("jsonc-parser");
const c=parse(require("fs").readFileSync(process.argv[1],"utf8"),[],{allowTrailingComma:true});
process.stdout.write((c.env.preview.d1_databases||[]).map(d=>d.database_name).join(","));
' "$ROOT/wrangler.jsonc")"
[ -n "$PREVIEW_DB" ] || fail "env.preview declares no database"
[ "$PROD_DB" != "$PREVIEW_DB" ] || fail "the preview database is the production database ($PROD_DB)"
log "PROVEN: the preview owns its data, separate from production"

RECEIPT="$(gh pr view "$PR" --json comments --jq '[.comments[].body | select(test("review receipt"))] | last // empty' 2>/dev/null || true)"
[ -n "$RECEIPT" ] || fail "PR #$PR has no factory review receipt yet"
printf '%s' "$RECEIPT" | grep -qi 'verified against the live preview' \
  || fail "the review receipt does not say it verified a live preview"
printf '%s' "$RECEIPT" | grep -qi 'neverMerge: true' \
  || fail "the review receipt is missing the never-merge guarantee"
printf '%s' "$RECEIPT" | grep -qiE 'decision: (ready-for-owner|request-changes)' \
  || fail "the review receipt has no decision"
log "PROVEN: the factory review receipt records a live preview verification"

( cd "$ROOT" && npm run check >/dev/null 2>&1 ) || fail "npm run check does not pass"
log "PROVEN: npm run check exits 0"

printf '\n# pass preview-per-pr: PR #%s has an isolated preview behind Access, running its own head, verified by the factory\n' "$PR"

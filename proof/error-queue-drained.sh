#!/usr/bin/env bash
set -euo pipefail

REPO="${QUEUE_REPO:-acoyfellow/my-ax}"
WORKER="${QUEUE_WORKER:-my-ax}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '[queue] %s\n' "$*" >&2; }
fail() { printf '[queue][FAIL] %s\n' "$*" >&2; exit 1; }

cd "$ROOT"

DEPLOYED_AT="$("$ROOT/node_modules/.bin/wrangler" deployments list --name "$WORKER" 2>/dev/null \
  | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' | tail -1)"
[ -n "$DEPLOYED_AT" ] || fail "could not read the deployed version time for $WORKER"
DEPLOYED_EPOCH="$(date -j -f "%Y-%m-%dT%H:%M:%S" "$DEPLOYED_AT" +%s 2>/dev/null || date -d "$DEPLOYED_AT" +%s)"
log "the running app was deployed at ${DEPLOYED_AT}Z"

STALE=0
while read -r number created; do
  [ -n "$number" ] || continue
  BODY="$(gh issue view "$number" --repo "$REPO" --json body --jq .body)"
  printf '%s' "$BODY" | grep -q "Auto error report" || continue
  CREATED_EPOCH="$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$created" +%s 2>/dev/null || date -d "$created" +%s)"
  if [ "$CREATED_EPOCH" -lt "$DEPLOYED_EPOCH" ]; then
    log "issue #$number was reported at $created, before the running app was deployed"
    STALE=$((STALE + 1))
  else
    log "issue #$number was reported at $created, after the deploy, so it is current work"
  fi
done < <(gh issue list --repo "$REPO" --state open --json number,createdAt --jq '.[]|"\(.number) \(.createdAt)"')

[ "$STALE" -eq 0 ] || fail "$STALE open auto-error issue(s) predate the running app; fix and deploy, or close with a reason"
log "PROVEN: no open auto-error issue predates the running deploy"

git fetch origin main --quiet
LOCAL_MAIN="$(git rev-parse origin/main)"
DEPLOYED_SHA="$(gh api "repos/$REPO/commits/main" --jq .sha)"
[ "$LOCAL_MAIN" = "$DEPLOYED_SHA" ] || fail "origin/main and the fetched main disagree"
log "PROVEN: main is $LOCAL_MAIN"

for gate in proof/factory-canary.sh proof/factory-no-loop.sh; do
  [ -f "$gate" ] || fail "$gate is missing; the factory gates must not be removed"
done
log "PROVEN: the factory gates are still present"

npm run check >/tmp/error-queue-check.log 2>&1 || fail "npm run check failed; see /tmp/error-queue-check.log"
log "PROVEN: npm run check exits 0"

printf '\n# pass error-queue-drained: no stale auto-error issue, factory gates intact, check green\n'

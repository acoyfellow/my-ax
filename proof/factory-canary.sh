#!/usr/bin/env bash
set -euo pipefail

REPO="${CANARY_REPO:-acoyfellow/my-ax}"
TIMEOUT="${CANARY_TIMEOUT:-240}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date -u +%Y%m%d%H%M%S)"
FP="$(printf 'canary%s' "$STAMP" | shasum -a 256 | cut -c1-16)"
ISSUE=""
PR=""
BRANCH=""

log() { printf '[canary] %s\n' "$*" >&2; }
fail() { printf '[canary][FAIL] %s\n' "$*" >&2; exit 1; }

cleanup() {
  set +e
  [ -n "$PR" ] && gh pr close "$PR" --repo "$REPO" --comment "Factory canary cleanup." >/dev/null 2>&1
  [ -n "$ISSUE" ] && gh issue close "$ISSUE" --repo "$REPO" --reason "not planned" --comment "Factory canary cleanup." >/dev/null 2>&1
  [ -n "$BRANCH" ] && gh api -X DELETE "repos/$REPO/git/refs/heads/$BRANCH" >/dev/null 2>&1
  set -e
}
trap cleanup EXIT

log "filing canary auto error issue (fingerprint $FP)"
BODY="## Auto error report

fingerprint: \`$FP\`
origin: server
message: Factory canary probe.
site: canary.ts

This issue was opened by My AX from a live error. One fingerprint is one issue.
This report opts in a ready PR. The factory opens the head branch and the pull request."

ISSUE="$(gh issue create --repo "$REPO" --title "bug: Factory canary probe." --body "$BODY" --json number --jq .number 2>/dev/null \
  || gh issue create --repo "$REPO" --title "bug: Factory canary probe." --body "$BODY" | grep -oE '[0-9]+$')"
[ -n "$ISSUE" ] || fail "could not create the canary issue"
BRANCH="bot/issue-$ISSUE"
log "issue #$ISSUE filed; waiting up to ${TIMEOUT}s for the Worker to open a ready PR"

DEADLINE=$(( $(date +%s) + TIMEOUT ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  PR="$(gh pr list --repo "$REPO" --state open --head "$BRANCH" --json number --jq '.[0].number // empty')"
  [ -n "$PR" ] && break
  sleep 10
done

[ -n "$PR" ] || fail "no ready PR for $BRANCH within ${TIMEOUT}s; the factory did not auto-triage the issue"
log "PROVEN: the Worker opened ready PR #$PR for issue #$ISSUE with no human step"

DRAFT="$(gh pr view "$PR" --repo "$REPO" --json isDraft --jq .isDraft)"
[ "$DRAFT" = "false" ] || fail "PR #$PR is a draft; the factory must open a ready PR"

cleanup
trap - EXIT
PR=""; ISSUE=""; BRANCH=""

OPEN_ISSUES="$(gh issue list --repo "$REPO" --state open --json number --jq 'length')"
OPEN_PRS="$(gh pr list --repo "$REPO" --state open --json number --jq 'length')"
[ "$OPEN_ISSUES" = "0" ] || fail "expected 0 open issues, found $OPEN_ISSUES"
[ "$OPEN_PRS" = "0" ] || fail "expected 0 open PRs, found $OPEN_PRS"
log "PROVEN: 0 open issues, 0 open PRs"

log "running npm run check on the current tree"
( cd "$ROOT" && npm run check >/tmp/canary-check.log 2>&1 ) || fail "npm run check failed; see /tmp/canary-check.log"
log "PROVEN: npm run check exits 0"

printf '\n# pass factory-canary: a new auto error issue auto-triages into a ready PR; 0 issues, 0 PRs, check green\n'
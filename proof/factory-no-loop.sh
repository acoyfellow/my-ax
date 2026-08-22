#!/usr/bin/env bash
set -euo pipefail

REPO="${LOOP_REPO:-acoyfellow/my-ax}"
PR_TIMEOUT="${LOOP_PR_TIMEOUT:-420}"
SWEEP_WAIT="${LOOP_SWEEP_WAIT:-1860}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ISSUE=""
PR=""
BRANCH=""

log() { printf '[no-loop] %s\n' "$*" >&2; }
fail() { printf '[no-loop][FAIL] %s\n' "$*" >&2; exit 1; }

cleanup() {
  set +e
  [ -n "$PR" ] && gh pr close "$PR" --repo "$REPO" --comment "No-loop probe cleanup." >/dev/null 2>&1
  [ -n "$ISSUE" ] && gh issue close "$ISSUE" --repo "$REPO" --reason "not planned" --comment "No-loop probe cleanup." >/dev/null 2>&1
  [ -n "$BRANCH" ] && gh api -X DELETE "repos/$REPO/git/refs/heads/$BRANCH" >/dev/null 2>&1
  set -e
}
trap cleanup EXIT

log "checking #109 is closed and its PR merged"
[ "$(gh issue view 109 --repo "$REPO" --json state --jq .state)" = "CLOSED" ] || fail "#109 must be closed"
[ "$(gh pr view 110 --repo "$REPO" --json state --jq .state)" = "MERGED" ] || fail "PR #110 must be merged"
log "PROVEN: #109 closed, PR #110 merged"

STAMP="$(date -u +%Y%m%d%H%M%S)"
FP="$(printf 'noloop%s' "$STAMP" | shasum -a 256 | cut -c1-16)"
BODY="## Auto error report

fingerprint: \`$FP\`
origin: server
message: No loop probe.
site: probe.ts

This issue was opened by My AX from a live error. One fingerprint is one issue.
This report opts in a ready PR. The factory opens the head branch and the pull request."

ISSUE="$(gh issue create --repo "$REPO" --title "bug: No loop probe." --body "$BODY" | grep -oE '[0-9]+$')"
[ -n "$ISSUE" ] || fail "could not create the probe issue"
BRANCH="bot/issue-$ISSUE"
log "issue #$ISSUE filed; waiting up to ${PR_TIMEOUT}s for a ready PR"

DEADLINE=$(( $(date +%s) + PR_TIMEOUT ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  PR="$(gh pr list --repo "$REPO" --state open --head "$BRANCH" --json number --jq '.[0].number // empty')"
  [ -n "$PR" ] && break
  sleep 10
done
[ -n "$PR" ] || fail "no ready PR for $BRANCH within ${PR_TIMEOUT}s"
log "PROVEN: ready PR #$PR opened with no human step"

log "waiting ${SWEEP_WAIT}s (past two 15 minute sweeps) to prove the sweep does not re-queue"
sleep "$SWEEP_WAIT"

BOARDS="$(gh issue view "$ISSUE" --repo "$REPO" --json comments --jq '[.comments[]|select(.body|test("^## loop board"))]')"
TOTAL="$(printf '%s' "$BOARDS" | jq 'length')"
PR_OPENED="$(printf '%s' "$BOARDS" | jq '[.[]|select(.body|test("stage: pr-opened"))]|length')"
LABELED_AFTER="$(printf '%s' "$BOARDS" | jq '
  (map(.body|test("stage: pr-opened"))|index(true)) as $i
  | if $i == null then 0
    else [.[$i+1:][]|select(.body|test("stage: labeled"))]|length end')"

log "boards=$TOTAL pr-opened=$PR_OPENED labeled-after=$LABELED_AFTER"
[ "$PR_OPENED" = "1" ] || fail "expected exactly 1 pr-opened board, found $PR_OPENED"
[ "$LABELED_AFTER" = "0" ] || fail "sweep regressed the stage: $LABELED_AFTER labeled board(s) after pr-opened"
[ "$TOTAL" -le 3 ] || fail "expected at most 3 boards, found $TOTAL"
log "PROVEN: no stage regression and no comment loop"

RECEIPTS="$(gh pr view "$PR" --repo "$REPO" --json comments --jq '[.comments[]|select(.body|test("## review receipt"))]|length')"
log "review receipts on PR #$PR: $RECEIPTS"
[ "$RECEIPTS" -le 1 ] || fail "review retry storm: $RECEIPTS receipts on PR #$PR (expected at most 1)"
log "PROVEN: the review posts at most one receipt"

cleanup
trap - EXIT
PR=""; ISSUE=""; BRANCH=""

OPEN_ISSUES="$(gh issue list --repo "$REPO" --state open --json number --jq 'length')"
OPEN_PRS="$(gh pr list --repo "$REPO" --state open --json number --jq 'length')"
[ "$OPEN_ISSUES" = "0" ] || fail "expected 0 open issues, found $OPEN_ISSUES"
[ "$OPEN_PRS" = "0" ] || fail "expected 0 open PRs, found $OPEN_PRS"
log "PROVEN: 0 open issues, 0 open PRs"

( cd "$ROOT" && npm run check >/tmp/no-loop-check.log 2>&1 ) || fail "npm run check failed; see /tmp/no-loop-check.log"
log "PROVEN: npm run check exits 0"

printf '\n# pass factory-no-loop: one pr-opened board, no labeled regression, 0 issues, 0 PRs, check green\n'
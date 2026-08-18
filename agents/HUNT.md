# Overnight hunt

One tick finds one new, checkable issue. Then it stops that hunt.

## Do

1. Read open issues titled `bug:` / `perf:` / `test:` so you do not refile.
2. Pick a different surface than the last filed issue.
3. Prove one fact with a command, a file:line, or a live URL.
4. File one GitHub issue. Title says `bug:`, `perf:`, or `test:`.
5. Stop. Next tick starts at step 1.

## Do not

- Open a pull request.
- Merge.
- Comment a cockpit of Approve/Reject into the issue body.
- Reuse an already-filed finding.
- Name people.

## Surfaces, in order, skip if already open

1. `agents/src/worker.ts` webhook payloads
2. `agents/src/ports.ts` GitHub hop count
3. `src/desk-board.ts` remaining mutant survivors
4. `src/session-turn.ts` composer lock
5. `agents/src/policy.ts` classify / audit findings

## Proof for a filed issue

The body must include at least one of:

- a command and its output
- a permalink to file and line
- a live issue, comment, or delivery URL

If you cannot attach that, do not file.

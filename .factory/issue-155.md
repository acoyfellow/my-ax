# Work branch for issue #155

title: bug: every notification turn makes a new session, so the session list is unusable
kind: bug
severity: p2

The factory opened this branch so the pull request has a commit to carry.
Replace this file with the fix, then push to this branch.

proof: npx tsx --test src/desk-board.test.ts agents/src/policy.test.ts agents/src/harness.test.ts agents/src/github-hmac.test.ts

A human merges. The Worker never merges and never approves.

# Work branch for issue #209

title: bug: No response from the agent, and no tool is running. The turn may have failed. Send another message to retry or steer.
kind: bug
severity: p2

The factory opened this branch so the pull request has a commit to carry.
Replace this file with the fix, then push to this branch.

proof: npx tsx --test src/desk-board.test.ts agents/src/policy.test.ts agents/src/harness.test.ts agents/src/github-hmac.test.ts

A human merges. The Worker never merges and never approves.

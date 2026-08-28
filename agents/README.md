# my-ax lifecycle agents

This is the default development loop. Issues and pull requests are handled here, not in a laptop Pi chat.

| Host | Who can reach it | Holds |
|---|---|---|
| the hook host (see `EMPLOYEE_HOOK_ROUTE` in local config) | GitHub (HMAC) | webhook secret |
| `my-ax-agents` (no public hostname) | hook service binding only | gateway token, GitHub token, Terrarium, workflows |

GitHub cannot do Access. Do not put the gateway Worker on `workers.dev` and do not Access-gate the hook. The hook verifies `x-hub-signature-256`, then service-binds to the inner Worker. The inner Worker re-checks HMAC.

| Workflow | Trigger | Does | Never |
|---|---|---|---|
| `TriageWorkflow` | `issues.opened` | classify, label, one loop board; create `bot/issue-<n>` with a seed commit, spawn an implementer, and open a ready PR only when that head has a product file | merge, comment twice, call a `.factory` seed ready |
| Sweep (cron `*/15`) | scheduled | close same-fingerprint duplicates; queue only issues that have no loop board and no open PR | comment storm, re-queue a boarded issue |
| `DigWorkflow` | hard bug | spawn Terrarium with a host `taskProof`, wait, proceed only if the receipt and the proof both hold | trust a callback or a receipt without `taskProof` |
| `AuditWorkflow` | `pull_request.opened/synchronize` | receipt comment with files and behind-main when GitHub returns them | approve or merge |
| `ReviewWorkflow` | same PR events | owner/`bot/issue-*` only: one proof receipt per step, verify the PR against its own live preview deploy, request changes when it can, or close flood | approve, merge, or touch foreign PRs |

A live error report is an opt-in for a **ready** GitHub PR (`draft: false`), not a GitHub draft. The method is `openReadyPr`. The head is `bot/issue-<n>`, and triage creates it with a seed commit, because a branch at the exact SHA of `main` makes `/pulls` answer 422. After the seed, triage spawns an implementer and lists files on that head. A ready PR opens only when at least one path is not under `.factory/`. The body uses `Closes #<n>` and does not invent a file list.

Every triage comment is a **loop board**: `stage` is `labeled`, `pr-opened`, `pr-failed`, `blocked-missing-branch` when branch creation fails, or `blocked-stamp` when the head has no product files. Worker never merges.

GitHub refuses a review on your own pull request. The review comment is the artifact; a rejected `requestChanges` is logged and does not fail the run. Each review action is a separate workflow step, so a retry never repeats the receipt comment.

## Proof

These gates are the receipts. Prose is not proof.

```sh
bash proof/factory-canary.sh    # an auto-error issue reaches a ready PR with no human step
bash proof/factory-no-loop.sh   # one pr-opened board, no stage regression, at most one
                                # review receipt, 0 open issues, 0 open PRs, check green
bash proof/error-queue-drained.sh  # no open auto-error issue predates the running deploy
bash proof/agentcast-live.sh       # the live browser opens, instructs, and returns a redacted receipt
bash proof/preview-per-pr.sh       # an open PR has an isolated preview behind Access, running its own head
bash proof/image-attachment.sh      # an image attachment reaches a vision model and the turn completes
bash proof/desk-live.sh            # the desk is a styled agent-authored app that updates live on every
                                   # client, both from an agent and from an action on the desk itself
bash proof/desk-app.sh             # the desk hosts an agent-authored app that can call the app back,
                                   # keeps free-form state, refuses a bad write, and does not lose a
                                   # concurrent write
bash proof/factory-implements.sh   # an opted-in draft does not open a ready PR on a .factory seed
bash proof/terminal-live.sh        # the deployed Worker serves a real pty; typed input executes
bash proof/terminal-remainders.sh  # desk session verbs, baked gh, no spike probes, no 2004h leak
bash proof/terminal-inline.sh      # no top-bar terminal; inline host; size is measured
```

`factory-no-loop.sh` waits past two 15 minute sweeps on purpose. The re-queue bug it guards only appears across sweep ticks.

`error-queue-drained.sh` compares each open auto-error issue against the deploy time of the running Worker. A merged but undeployed fix looks exactly like a broken fix, so the gate reads the live deploy rather than `main`.

`agentcast-live.sh` calls the real service and needs `AGENTCAST_ISSUER_KEY`, so it is opt-in and never runs in CI. It stops every session it opens, including on failure, because a gate that leaks browser capacity is a broken gate.

`preview-per-pr.sh` proves a review is evidence about deployed code. It requires that an unauthenticated request to the preview host is refused, that the host answers 200 through Access, that the deployed commit is that PR head, that the preview database is not the production database, and that the PR carries a review receipt saying it verified a live preview. It needs an Access token, so it is opt-in and never runs in CI.

Hunt ticks that only file issues: [HUNT.md](./HUNT.md).

Model: `AGENTS_MODEL` (default `grok-4.6`). Inference only through employee-injected `LLM_GATEWAY_URL` + `LLM_GATEWAY_TOKEN`.

```sh
npx tsx --test agents/src/policy.test.ts agents/src/harness.test.ts agents/src/github-hmac.test.ts agents/src/sweep.test.ts agents/src/review.test.ts
```

Employee deploy: `my-ax-private/deploy-agents.sh`.

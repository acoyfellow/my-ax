# my-ax lifecycle agents

This is the default development loop. Issues and pull requests are handled here, not in a laptop Pi chat.

| Host | Who can reach it | Holds |
|---|---|---|
| `hooks.ax.cloudflare.dev` | GitHub (HMAC) | webhook secret |
| `my-ax-agents` (no public hostname) | hook service binding only | gateway token, GitHub token, Terrarium, workflows |

GitHub cannot do Access. Do not put the gateway Worker on `workers.dev` and do not Access-gate the hook. The hook verifies `x-hub-signature-256`, then service-binds to the inner Worker. The inner Worker re-checks HMAC.

| Workflow | Trigger | Does | Never |
|---|---|---|---|
| `TriageWorkflow` | `issues.opened` | classify, label, one loop board; create `bot/issue-<n>` with a seed commit and open a ready PR when the issue is a live error | merge, comment twice |
| Sweep (cron `*/15`) | scheduled | close same-fingerprint duplicates; queue only issues that have no loop board and no open PR | comment storm, re-queue a boarded issue |
| `DigWorkflow` | hard bug | spawn Terrarium with a host `taskProof`, wait, proceed only if the receipt and the proof both hold | trust a callback or a receipt without `taskProof` |
| `AuditWorkflow` | `pull_request.opened/synchronize` | receipt comment with files and behind-main when GitHub returns them | approve or merge |
| `ReviewWorkflow` | same PR events | owner/`bot/issue-*` only: one proof receipt per step, verify the PR against its own live preview deploy, request changes when it can, or close flood | approve, merge, or touch foreign PRs |

A live error report is an opt-in for a **ready** GitHub PR (`draft: false`), not a GitHub draft. The method is `openReadyPr`. The head is `bot/issue-<n>`, and triage creates it with a seed commit, because a branch at the exact SHA of `main` makes `/pulls` answer 422. The body uses `Closes #<n>` and does not invent a file list.

Every triage comment is a **loop board**: `stage` is `labeled`, `pr-opened`, `pr-failed`, or `blocked-missing-branch` when branch creation fails. Worker never merges.

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

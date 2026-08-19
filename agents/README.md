# my-ax lifecycle agents

This is the default development loop. Issues and pull requests are handled here, not in a laptop Pi chat.

| Host | Who can reach it | Holds |
|---|---|---|
| `hooks.ax.cloudflare.dev` | GitHub (HMAC) | webhook secret |
| `my-ax-agents` (no public hostname) | hook service binding only | gateway token, GitHub token, Terrarium, workflows |

GitHub cannot do Access. Do not put the gateway Worker on `workers.dev` and do not Access-gate the hook. The hook verifies `x-hub-signature-256`, then service-binds to the inner Worker. The inner Worker re-checks HMAC.

| Workflow | Trigger | Does | Never |
|---|---|---|---|
| `TriageWorkflow` | `issues.opened` | classify, label, one loop board; open a ready PR when the issue is a live error and `bot/issue-<n>` exists | merge, comment twice |
| Sweep (cron `*/15`) | scheduled | close same-fingerprint duplicates; queue issues with no board or with a head | comment storm, unbounded close |
| `DigWorkflow` | hard bug | spawn Terrarium with a host `taskProof`, wait, proceed only if the receipt and the proof both hold | trust a callback or a receipt without `taskProof` |
| `AuditWorkflow` | `pull_request.opened/synchronize` | receipt comment with files and behind-main when GitHub returns them | approve or merge |
| `ReviewWorkflow` | same PR events | owner/`bot/issue-*` only: proof comment, request changes, or close flood | approve, merge, or touch foreign PRs |

A live error report is an opt-in for a **ready** GitHub PR (`draft: false`), not a GitHub draft. The method is `openReadyPr`. The head is `bot/issue-<n>`. The body uses `Closes #<n>` and does not invent a file list.

Every triage comment is a **loop board**: `stage` is `labeled`, `blocked-missing-branch`, `pr-opened`, or `pr-failed`. If the head branch is missing, the board says so. Worker never merges.

Hunt ticks that only file issues: [HUNT.md](./HUNT.md).

Model: `AGENTS_MODEL` (default `grok-4.6`). Inference only through employee-injected `LLM_GATEWAY_URL` + `LLM_GATEWAY_TOKEN`.

```sh
npx tsx --test agents/src/policy.test.ts agents/src/harness.test.ts agents/src/github-hmac.test.ts
```

Employee deploy: `my-ax-private/deploy-agents.sh`.

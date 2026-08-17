# my-ax lifecycle agents

This is the default development loop. Issues and pull requests are handled here, not in a laptop Pi chat.

| Host | Who can reach it | Holds |
|---|---|---|
| `hooks.ax.cloudflare.dev` | GitHub (HMAC) | webhook secret |
| `my-ax-agents` (no public hostname) | hook service binding only | gateway token, GitHub token, Terrarium, workflows |

GitHub cannot do Access. Do not put the gateway Worker on `workers.dev` and do not Access-gate the hook. The hook verifies `x-hub-signature-256`, then service-binds to the inner Worker. The inner Worker re-checks HMAC.

| Workflow | Trigger | Does | Never |
|---|---|---|---|
| `TriageWorkflow` | `issues.opened` | classify, label, comment; draft only with `triage:draft` | merge |
| `DigWorkflow` | hard bug | spawn Terrarium, wait, proceed only on a verified receipt | trust a callback alone |
| `AuditWorkflow` | `pull_request.opened/synchronize` | receipt comment | approve or merge |

Model: `AGENTS_MODEL` (default `grok-4.6`). Inference only through employee-injected `LLM_GATEWAY_URL` + `LLM_GATEWAY_TOKEN`.

```sh
npx tsx --test agents/src/policy.test.ts agents/src/harness.test.ts agents/src/github-hmac.test.ts
```

Employee deploy: `my-ax-private/deploy-agents.sh`.

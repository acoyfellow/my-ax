# my-ax lifecycle agents

This is the default development loop. Issues and pull requests are handled here, not in a laptop Pi chat.

| Workflow | Trigger | Does | Never |
|---|---|---|---|
| `TriageWorkflow` | `issues.opened` | classify, label, comment; draft only with `triage:draft` | merge |
| `DigWorkflow` | hard bug | spawn Terrarium, wait, proceed only on a verified receipt | trust a callback alone |
| `AuditWorkflow` | `pull_request.opened/synchronize` | receipt comment | approve or merge |

Model: `AGENTS_MODEL` (default `grok-4.6`). Inference only through employee-injected `LLM_GATEWAY_URL` + `LLM_GATEWAY_TOKEN`. Public Actions never see those secrets.

```sh
npx tsx --test agents/src/policy.test.ts agents/src/harness.test.ts
```

Employee deploy: `my-ax-private/deploy-agents.sh` clones this repo and injects the gateway. The product Worker (`deploy-employee.sh`) is a sibling, not this process.

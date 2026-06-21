# My Agent Experience — Feature Status and Limits

## A2A deployment links

| Capability | Status |
|---|---|
| Public A2A 1.0 agent card | ✅ `/.well-known/agent-card.json` |
| Directional inbound grants | ✅ Owner create/list/revoke; opaque bearer shown once |
| Text-only user message send | ✅ `POST /a2a/message:send` |
| Durable dedupe | ✅ Exact replay; changed payload for a messageId returns 409 |
| Owner review | ✅ Accept/reject/block; block revokes sender grant |
| Remote execution | Intentionally absent: no Think, MCP, tools, or workspace |

Only SHA-256 token digests are persisted. Public routes reveal no owner identity,
tasks are scoped to the presenting grant, and owner controls remain behind
Cloudflare Access. Treat a grant like a password and revoke it after use.
Accepted tasks remain inert review records; remote instructions are not executed.

This table describes behavior in the current repository. `npm run check` covers local type, unit, and widget checks; deployment-only behavior names its proof command or source path.

Status:

- ✅ **Shipped** — present in the current tree with a named check or source path.
- 🧪 **Proving** — implemented, but the boundary or production evidence is still narrow.
- ⚠️ **Partial** — useful with a known missing path.
- ⏭ **Planned** — not implemented.

## Conversation and Client

| Capability | Status | Mechanism and Limit | Evidence |
|---|---:|---|---|
| Durable conversations | ✅ | A `MyAgent` Think facet owns each conversation. User messages persist before model execution; provider failure can still end a turn. | `src/agent.ts`, `npm run prove:resume` |
| Stream recovery | ✅ | Think recovery plus a `120s` parked-stream watchdog. The watchdog terminates or recovers the observed stalled path; it is not a provider availability guarantee. | `src/agent.ts`, `npm run prove:resume` |
| Conversation switching | ✅ | The Svelte client closes the active socket, clears transient state, and connects to the selected facet without a document reload. | `proof/svelte/Chat.svelte` |
| Notification deep links | ✅ | Attention clicks and warm service-worker/PWA launches deliver a same-origin target to the mounted chat; session targets switch the active facet. | `npm run test:deep-links` |
| Transcript export and feed | ✅ | D1 projects new turns into owner-scoped export and cursor endpoints. The projection is separate from Think's live state. | `src/routes/sessions.ts`, `npm run test:session-entries` |
| Voice in the active conversation | ✅ | A direct-routed Voice agent delegates text turns into the canonical Think facet. Browser microphone and audio policies still apply. | `src/voice-think-agent.ts`, `npm run prove:browser` |
| Installable PWA | ✅ | Manifest, service worker, offline shell, badges, and deep links are present. Offline mode does not run model turns. | `public/sw.js`, `proof/svelte/` |

## Work and Tools

| Capability | Status | Mechanism and Limit | Evidence |
|---|---:|---|---|
| Unified work surface | ✅ | `work_search` discovers methods; `work_code` dispatches one async program across `workspace.*`, `machine.*`, and `cloudbox.*`. Calls record location, method, status, and duration. | `src/work-tools.ts`; deployed trace in `docs/media/` |
| My AX Workspace | ✅ | `/home/user` lives in Cloudflare Sandbox and snapshots to R2 after mutating turns. Writes after the last successful snapshot can be lost with the container. | `src/workspace.ts`, `src/think-workspace.ts` |
| My Machine | 🧪 | An outbound Machinectl connection contributes its live catalog under `machine.*`. Methods run with the connected user's local authority. | `src/routes/machinectl.ts`; deployed trace in `docs/media/` |
| Cloudbox runs | 🧪 | Optional `cloudbox.*` methods create a public-repository run, read/write relative files, and execute commands. No publication method is exposed. | `src/cloudbox-tools.ts`; deployed trace in `docs/media/` |
| User-added MCPs | ✅ | Users add public HTTPS servers and complete their OAuth flow. Private, loopback, metadata, and credential-bearing destinations are rejected. | `src/connectors.ts`, `src/public-url.ts`, `npm run test:public-url` |
| MCP Code Mode | 🧪 | An exact deployment policy exposes reviewed read/query methods. New and unlisted methods remain excluded. | `src/mcp-code-mode.ts`, `npm run test:mcp-code-mode` |
| Human decisions | ✅ | `ask_user` stores an owner-scoped decision, writes Attention, and injects the validated answer into the source conversation. | `src/routes/decisions.ts` |

No current comparative benchmark is published for native tools versus Code Mode. Code Mode adds Worker Loader startup overhead and reduces eager schema exposure for multi-call programs; the repository does not claim a general latency improvement.

## Models and Browser

| Capability | Status | Mechanism and Limit | Evidence |
|---|---:|---|---|
| Operator model catalog | ✅ | The deployment chooses from the catalog in `src/models.ts`. Workers AI routes use the binding; gateway routes need deployment-owned configuration. | `src/models.ts`, `src/llm.ts` |
| Vision attachments | ✅ | Owner-scoped R2 bytes are attached only for models marked vision-capable. Other models receive an omission notice. | `src/agent.ts`, `src/uploads.ts` |
| Public-page Browser Run | ✅ | `browser_open` captures title, text, screenshot, and an rrweb recording for public HTTP(S) destinations. It has no user's local browser cookies. | `src/browser-tools.ts`, `npm run prove:browser` |
| Authenticated local browser | ⚠️ | Available only through methods published by a connected Machinectl companion. | `src/routes/machinectl.ts` |
| Svelte artifacts | ✅ | Self-contained Svelte source is compiled, stored in R2/D1, and rendered through a same-origin `allow-scripts` iframe. | `npm run prove:artifacts`, `npm run test:tool-widgets` |
| Artifact revision workflow | ⏭ | Existing artifacts can be listed and deleted; edit/fork/version UI is not implemented. | `src/routes/artifacts.ts` |

## Attention and Jobs

| Capability | Status | Mechanism and Limit | Evidence |
|---|---:|---|---|
| Web Push | ✅ | Owner subscriptions receive best-effort VAPID push. Invalid endpoints are pruned; the Attention row remains when delivery fails. | `src/push.ts`, `src/notify.ts` |
| Attention inbox | ✅ | D1 stores recent owner-scoped items, unread state, href, and source session. | `src/routes/attention.ts`, `proof/svelte/Attention.svelte` |
| Recurring prompts | ✅ | Think's per-DO schedules run saved prompts; D1 stores the owner-facing index and last result. | `src/jobs.ts`, `src/routes/jobs.ts` |
| Unified turn state | ⚠️ | Decisions resume durably, but chat, job, decision, cancellation, and failure do not yet share one state record. | `src/agent.ts`, `src/jobs.ts` |
| Quiet hours | ⏭ | No delivery schedule or category preferences are implemented. | — |

## Identity and Storage

| Capability | Status | Mechanism and Limit | Evidence |
|---|---:|---|---|
| Access identity | ✅ | Production verifies the Access JWT issuer, audience, signature, and expiry; routes scope data by the resulting email. | `src/auth.ts`, `npm run prove` |
| OAuth encryption | ✅ | `OAuthClientDO` encrypts tokens under `MASTER_KEY` and refreshes before expiry. Rotating the key makes existing grants unreadable. | `src/oauth-store.ts` |
| Transcript search | ✅ | D1 FTS indexes the projected conversation rows. Search does not query unprojected live state. | `src/conversation-log.ts` |
| Workspace backups | ✅ | R2 stores Sandbox backups; D1 stores the latest successful pointer. R2 S3 credentials are required in addition to the binding. | `src/workspace.ts`, `docs/deploy.md` |
| Run receipts | 🧪 | The owner-scoped event ledger stores explicitly appended events. It does not automatically capture every tool call. | `src/run-receipts.ts`, `npm run test:run-receipts` |

## Deployment, Security, and Operations

| Capability | Status | Mechanism and Limit | Evidence |
|---|---:|---|---|
| Public GitHub engine | ✅ | Repository is public, history/tree pass the checked-in leak gate, and organization-specific account ids, routes, Access values, gateway config, and MCP catalog live in a private wrapper. | `npm run verify:public`, `SECURITY.md` |
| Private organization deployment | ✅ | Wrapper clones public `main`, injects private config and resource ids, applies D1 migrations, deploys, then requires repeated authenticated in-app checks. | private deployment wrapper; `/api/health` |
| Post-deploy auth gate | ✅ | Deployment requires five consecutive authenticated `/api` responses; edge Access alone cannot false-pass a Worker with broken issuer/audience config. | private deployment wrapper |
| Browser/Push URL policy | ✅ | Shared public-URL policy rejects literal private/loopback/link-local/reserved destinations and credentials; Browser validates requests/final URL and Push disables redirects. DNS rebinding remains an infrastructure-level boundary. | `src/public-url.ts`, `npm run test:public-url` |
| Browser recording ownership | ✅ | D1 maps recordings to owner/session and recording retrieval fails closed for unowned or pre-index recordings. | `migrations/0007_browser_recordings.sql`, `src/routes/browser.ts` |
| Bridge ticket ownership | ✅ | Ticket subject must match the current Access email+sub; ticket mint also requires an owned session and connector. | `src/bridge.ts`, `src/routes/sessions.ts` |
| MCP self-healing | ✅ | Authorized registrations with an empty discovered catalog are removed and rehydrated; removed/unauthorized servers are revoked from live facets. | `src/agent.ts` |
| Workspace restore safety | ✅ | Restore failure remains degraded/retryable; no ready marker or empty-state snapshot can overwrite the last pointer. Versioned pointers prevent slower old backups becoming latest. | `src/workspace.ts`, migrations `0008` |
| Observability/SLOs | ⚠️ | Structured console events, D1 status fields, health checks, run receipts, and deployed proof scripts exist. There is no declared SLO, dashboard, alert policy, or automatic failed-snapshot/job reconciliation service. | `/api/health`, `src/agent.ts`, `src/jobs.ts` |
| Setup portability | ⚠️ | Fresh setup fails closed and documents Node/npm/Docker/Python/Bash/WSL2 prerequisites. CI validates Wrangler and Docker on Linux; native Windows/macOS setup is not automated. | `scripts/setup.sh`, `.github/workflows/check.yml` |

## Additional Shipped Product Details

| Capability | Status | Mechanism and Limit | Evidence |
|---|---:|---|---|
| Completion push while away | ✅ | Successful turns push only when no visible client is watching; title includes prompt context and body includes the actual reply. | `src/agent.ts`, `src/notify.ts` |
| Interactive decision push | ✅ | Pending decisions reopen from Attention or the source conversation; explicit option selection + Submit resumes the agent and records the answer. | `src/routes/decisions.ts`, `proof/svelte/Chat.svelte` |
| MCP portal integration | ✅ | A private deployment can inject one portal connector; native MCP discovery and optional reviewed Code Mode operate over the live authenticated catalog. | `src/connectors.ts`, `src/agent.ts`, `src/mcp-code-mode.ts` |
| Current model registry | ✅ | Kimi K2.7 Code, GLM 5.2, Opus 4.8, GPT-5.5, Kindle Alpha API, and Mercury Alpha. Stale/removed ids heal to the default. Availability of gateway-backed models remains deployment-specific. | `src/models.ts`, `src/llm.ts` |
| Effect outbound-I/O substrate | ✅ | Effect handles typed failures, timeout, retry, and bounded concurrency for MCP probing/Code Mode, push fan-out, and OAuth refresh transport. Think/Agents lifecycle remains native. | `src/mcp-probe.ts`, `src/notify.ts`, `src/oauth-store.ts` |
| Deployment media/proof | 🧪 | A checked-in accelerated video demonstrates one unified Work Code Mode flow. It is evidence for that path, not a claim that every product surface is covered. | `docs/media/`, `README.md` |

## Discussed or Implied, but Not Fully Implemented

| Item | Status | What is missing / decision needed |
|---|---:|---|
| Full organization MCP canary | ⏭ | Private wrapper has the connector and Code Mode allowlist, but no repeatable expected-server manifest plus one safe read-only probe per upstream, drift report, and receipt. |
| Authenticated GitHub integration | ⚠️ | Public GitHub pages/API can be browsed and a connected machine may have `gh`; there is no built-in owner OAuth GitHub connector in the public engine. Add via user MCP or a private portal. |
| Durable inference / never waste a token | ⏭ | No `durableBuffer` or AI Gateway run-cursor resume is active. Adopt managed AI Gateway/Think durable resume when the public primitive is available; do not build another custom inference-buffer DO. |
| Native vs Code Mode benchmark | ⏭ | Simple-call evidence exists informally, but there is no checked-in, repeatable multi-call benchmark with latency, schema/context, failures, and quality scoring. |
| Unified durable work/turn state | ⚠️ | Chat, jobs, decisions, processes, cancellation, and failure use separate state models. One owner-scoped `running/completed/needs_input/failed/cancelled` contract is not implemented. |
| Glance ambient control surface | ⚠️ | My AX exposes owner-scoped Attention read/ack primitives and records a Glance receipt, but Glance UI/deployment integration is not part of this repository. |
| Access branding automation | ⏭ | Product/PWA branding exists; Zero Trust login-page/app branding is still an operator dashboard/configuration task, not setup automation. |
| Personal reference deployment parity | ⚠️ | Public README names the reference deployment, but there is no repository gate proving it runs the same current commit and full generic capability set as the employee instance. |
| Release/deploy Attention | ⏭ | Deploy verifies health but does not publish a concise owner Attention item or release summary. |
| Notification preferences/quiet hours | ⏭ | Push works; category controls, quiet hours, and digest policy are absent. |
| Artifact revision/library UX | ⏭ | Artifacts are durable and listable, but edit/fork/version/reuse UI is absent. |
| True owner-wide semantic memory | ⚠️ | D1 provides owner-wide transcript search. Think Session memory remains conversation-facet-local; no separate owner memory actor/vector layer exists. |
| Immediate actor destruction | ⚠️ | Session deletion cancels indexed schedules and data, but Durable Object instances are not physically deleted as a product primitive. Authorization requires the D1 owner row, so deleted actors are unreachable. |
| Workspace mutation serialization | ⚠️ | Versioned pointers prevent stale backup ordering, but simultaneous conversation facets can still mutate the same owner Sandbox without a single owner-root transaction coordinator. |
| Full operational observability | ⏭ | No p95 turn/resume SLO, failed-snapshot alarm, job reconciliation dashboard, OAuth-refresh alert, or release rollback runbook with owners/thresholds. |

## Planning Priorities

| Priority | Work | Why now / definition of done |
|---:|---|---|
| P0 | Reliability release gate | Keep Access, normal turn, multi-turn, resume, switching, idle ping/pong, voice, push, model registry, D1 schemas, and workspace restore in one private post-deploy canary. Feature work stops on failure. |
| P0 | Full organization MCP canary | Private expected-server list, one safe read-only probe per upstream, native-tool count, Code Mode policy check, no payload logging, non-zero exit on drift. |
| P1 | Cloudflare dependency cohort upgrade | Upgrade Think 0.10.0 + Agents 0.16.2 + Voice 0.3.1 + Code Mode 0.4.1 together in a branch; run typecheck, unit, resume, voice, MCP hydration, Code Mode, and production smoke before merging. |
| P1 | AI Gateway provider/resume spike | Evaluate `workers-ai-provider` 3.2.0 third-party plugins and experimental resumable streams against the current gateway. Keep current routing until byte-exact resume, tools, reasoning, and auth are proven. |
| P1 | Unified durable state | Define one state/event contract shared by chat turns, decisions, recurring jobs, long-running work, push, and Attention. Run receipts become the evidence log, not a second scheduler. |
| P1 | Job reconciliation | Enumerate D1 jobs versus native schedules, repair orphaned rows/schedules, make retries idempotent, and expose last verified schedule state. |
| P1 | Workspace owner coordinator | Move mutation/snapshot coordination into the owner root or workspace actor so concurrent facets have an explicit serialization/commit contract. |
| P2 | Artifact revision workflow | Add fork/edit/rerun/version only after defining ownership, CSP, storage retention, and a minimal non-dashboard UX. |
| P2 | Notification policy | Add quiet hours/categories/digest only after measuring real push volume and missed-attention rate. |
| P2 | Operational SLOs | Define and instrument successful-turn, resume, snapshot, schedule, OAuth, push, and MCP hydration SLOs with actionable alerts. |

## Cloudflare Dependency Review — 2026-06-18

| Package | Current | npm latest | Plan |
|---|---:|---:|---|
| `@cloudflare/think` | 0.9.0 | 0.10.0 | Upgrade only with Agents/Voice/Code Mode cohort. README API is nearly unchanged; dependency moves to Code Mode `^0.4.1` and `create-think ^0.1.0`. High regression risk around facets/recovery. |
| `agents` | 0.16.0 | 0.16.2 | Cohort patch candidate; validate sub-agent routing, MCP registration/removal, schedules, and resume. |
| `@cloudflare/voice` | 0.3.0 | 0.3.1 | Cohort patch candidate. Package explicitly warns that APIs may break; retain exact pin and run live voice lifecycle. |
| `@cloudflare/codemode` | 0.4.0 | 0.4.1 | Cohort patch candidate; rerun policy/collision tests plus Work and MCP Code Mode. |
| `workers-ai-provider` | 3.1.14 | 3.2.0 | Separate experimental spike. 3.2 adds third-party AI Gateway plugins and resumable streaming; potentially collapses `llm.ts`, but depends on undocumented/new Gateway behavior. Do not silently upgrade production routing. |
| `@cloudflare/sandbox` | 0.12.1 | 0.12.1 | Current. SDK and `cloudflare/sandbox:0.12.1` image must move atomically. |
| `@cloudflare/shell` | 0.4.0 | 0.4.0 | Current. Evaluate `stateTools(workspace)` later for deleting compatible custom workspace glue. |
| `@cloudflare/worker-bundler` | 0.2.1 | 0.2.1 | Current; keep exact. |
| `@cloudflare/puppeteer` | 1.1.0 | 1.1.0 | Current; change caret to exact during next dependency commit for deterministic Browser behavior. |
| `wrangler` | 4.100.0 | 4.101.0 | Low-risk patch after dry-run, Docker build, migration, private deploy, and repeated in-app Access checks. |
| AI SDK (`ai`, OpenAI, Anthropic, compatible) | 6.0.205 / 3.0.71 / 3.0.84 / 2.0.50 | 6.0.208 / 3.0.73 / 3.0.85 / 2.0.51 | Patch as part of the tested runtime cohort, not independently during reliability work. |
| `hono` | 4.12.25 | 4.12.26 | Routine patch with route/auth negative tests. |

Dependency principle: exact-pin experimental Cloudflare agent packages; upgrade coupled packages together; update Sandbox SDK and image atomically; prefer managed Cloudflare primitives when they demonstrably remove custom code, but do not trade away owner boundaries or production evidence.

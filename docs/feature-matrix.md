# My Agent Experience — Feature Status and Limits

This page describes the current repository, not a roadmap. Use it to answer: "what is real, where does it live, and what are the known limits?"

Status:

- ✅ shipped in this tree with source or test evidence
- 🧪 implemented, but production evidence or boundary coverage is narrow
- ⚠️ useful, with an explicit missing path
- ⏭ intentionally absent for now

## Owner Loop

| Capability | Status | Current shape | Evidence |
|---|---:|---|---|
| Check-in | ✅ | `GET /api/check-in` and MCP `my_ax_check_in` summarize unread Attention, running jobs, active run receipts, recent completion, and suggested steers without adding storage. | `src/check-in.ts`, `npm run test:check-in` |
| Attention inbox | ✅ | D1 stores owner-scoped items with unread state, href, and optional source session. Push delivery is best effort; the row remains if push fails. | `src/routes/attention.ts`, `src/notify.ts` |
| Completion receipts | ✅ | Normal turns can push completion while the owner is away. Recurring scheduled/manual job runs share terminalization and emit an actionable Attention receipt. Delegated child batches now leave an owner-visible Attention receipt when the batch terminalizes. | `src/agent.ts`, `src/recurring-job-run.ts`, `src/delegate-receipt.ts` |
| Run receipts | 🧪 | Owner-scoped ledger for explicitly appended events. It does not automatically capture every tool call or deploy. | `src/run-receipts.ts`, `npm run test:run-receipts` |

## Conversation and Client

| Capability | Status | Current shape | Evidence |
|---|---:|---|---|
| Durable conversations | ✅ | A `MyAgent` Think facet owns each conversation. User messages persist before model execution; provider/runtime failure can still end a turn. | `src/agent.ts`, `npm run prove:resume` |
| Stream recovery | ✅ | Think recovery plus a parked-stream watchdog covers the observed stalled path. It is not a provider availability guarantee. | `src/agent.ts`, `npm run prove:resume` |
| Conversation switching | ✅ | The Svelte client reconnects to the selected facet without document reload. | `proof/svelte/Chat.svelte` |
| Notification deep links | ✅ | Attention/PWA launches deliver same-origin targets; session targets switch the active facet. | `npm run test:deep-links` |
| Transcript feed/export/search | ✅ | D1 projects conversation rows for feed, export, and FTS search. Live Think state remains authoritative. | `src/routes/sessions.ts`, `src/conversation-log.ts` |
| Voice in active conversation | ✅ | Voice routes text turns into the canonical Think facet. Browser microphone activation remains explicit browser/user policy. | `src/voice-think-agent.ts`, `npm run prove:browser` |
| Installable PWA | ✅ | Manifest, service worker, offline shell, badges, and deep links exist. Offline mode does not run model turns. | `public/sw.js`, `proof/svelte/` |

## Work and Tools

| Capability | Status | Current shape | Evidence |
|---|---:|---|---|
| Unified work surface | ✅ | `work_search` discovers methods; `work_code` dispatches one async program across workspace, Machine, and Cloudbox namespaces. | `src/work-tools.ts` |
| Workspace | ✅ | `/home/user` lives in Cloudflare Sandbox; mutating turns snapshot to R2. Writes after the last successful snapshot can be lost with the container. | `src/workspace.ts` |
| My Machine | 🧪 | An outbound Machinectl companion contributes live `machine.*` methods with the connected user's local authority. | `src/routes/machinectl.ts` |
| Cloudbox | 🧪 | Optional `cloudbox.*` methods create public-repo runs and operate on relative files. No publication method is exposed. | `src/cloudbox-tools.ts` |
| Browser run | ✅ | `browser_open` captures public-page title, text, screenshot, and rrweb recording. It has no local-browser cookies. | `src/browser-tools.ts`, `npm run prove:browser` |
| Authenticated local browser | ⚠️ | Available only through a connected Machinectl companion that chooses to publish such methods. | `src/routes/machinectl.ts` |
| User-added MCPs | ✅ | Public HTTPS MCP servers can be connected; OAuth grants are encrypted. Private/loopback/metadata/credential-bearing destinations are rejected. | `src/connectors.ts`, `src/public-url.ts` |
| MCP Code Mode | 🧪 | Reviewed read/query methods are exposed by allowlist; unlisted methods stay excluded. | `src/mcp-code-mode.ts`, `npm run test:mcp-code-mode` |
| Human decisions | ✅ | `ask_user` writes an owner-scoped decision and Attention item, then injects the validated answer into the source conversation. | `src/routes/decisions.ts` |
| Svelte artifacts | ✅ | Self-contained Svelte source compiles, stores in R2/D1, and renders through same-origin sandboxed iframe. | `npm run prove:artifacts`, `npm run test:tool-widgets` |

## Jobs, Models, and Storage

| Capability | Status | Current shape | Evidence |
|---|---:|---|---|
| Recurring prompts | ✅ | Native per-session schedules run saved prompts. HTTP routes, Think tools, Code Mode, and MCP share one owner-scoped job service; D1 stores job state and durable history. | `src/jobs.ts`, `src/job-service.ts` |
| Job drift repair | ⚠️ | Creation/update paths compensate known partial failures, but there is no automatic D1-vs-native-schedule reconciliation loop. | `src/jobs.ts`, `src/job-service.ts` |
| Model catalog | ✅ | The deployment chooses models from `src/models.ts`; gateway-backed availability remains deployment-specific. | `src/models.ts`, `src/llm.ts` |
| Vision attachments | ✅ | Owner-scoped R2 bytes attach only for models marked vision-capable; other models receive an omission notice. | `src/agent.ts`, `src/uploads.ts` |
| OAuth encryption | ✅ | `OAuthClientDO` encrypts tokens under `MASTER_KEY` and refreshes before expiry. Replacing the key makes existing grants unreadable. | `src/oauth-store.ts` |
| Workspace backups | ✅ | R2 stores Sandbox backups; D1 stores the latest successful pointer. R2 S3 credentials are required in addition to the binding. | `src/workspace.ts`, `docs/deploy.md` |

## Deployment, Security, and Operations

| Capability | Status | Current shape | Evidence |
|---|---:|---|---|
| Access identity | ✅ | Production verifies Access JWT issuer, audience, signature, and expiry; routes scope data by email. | `src/auth.ts`, `npm run prove` |
| Public engine / private wrapper | ✅ | Public tree passes leak gate. Account ids, routes, Access values, gateway config, and private MCP catalog live outside the public repo. | `npm run verify:public`, `SECURITY.md` |
| Independent installations | ✅ | Source revision can be shared; runtime storage, credentials, Access apps, and Durable Object namespaces must not be shared. | `docs/deploy.md` |
| Post-deploy auth gate | ✅ | Private wrapper requires repeated authenticated `/api` responses after deploy; edge Access alone cannot false-pass broken Worker auth config. | `docs/deploy.md` |
| URL policy | ✅ | Shared public-URL policy rejects literal private/loopback/link-local/reserved destinations and credentials; Browser validates request and final URL. | `src/public-url.ts`, `npm run test:public-url` |
| Recording and bridge ownership | ✅ | Browser recordings and bridge tickets are owner/session scoped and fail closed when ownership cannot be proven. | `src/routes/browser.ts`, `src/bridge.ts` |
| Workspace restore safety | ✅ | Restore failure is degraded/retryable; no ready marker or empty snapshot can overwrite the last pointer. Versioned pointers prevent stale backup ordering. | `src/workspace.ts`, migrations `0008` |
| Observability | ⚠️ | Structured console events, health checks, status fields, run receipts, and proof scripts exist. There is no declared SLO, dashboard, or automatic reconciliation service. | `/api/health`, `src/agent.ts`, `src/jobs.ts` |

## Not Implemented On Purpose

| Item | Status | Boundary |
|---|---:|---|
| Generic workflow engine | ⏭ | My AX steers work and records receipts; it does not replace Trigger/Hatchet-style systems. |
| Broad dashboard redesign | ⏭ | Check-in is the front door. Bigger UI surfaces should earn their way in through one owner journey. |
| A2A/federation | ⏭ | Paused until a concrete single-operator product need appears. Installations remain isolated. |
| Quiet hours/preferences | ⏭ | Push exists; category controls, quiet hours, and digest policy are absent. |
| Artifact edit/fork/version UX | ⏭ | Artifacts are durable/listable; library workflow is absent. |
| Owner-wide semantic memory | ⚠️ | D1 transcript search exists. There is no separate owner memory actor/vector layer. |
| Immediate Durable Object destruction | ⚠️ | Deleting a session removes owner reachability and indexed schedules/data; it does not physically delete DO instances. |
| One universal state record | ⚠️ | Jobs share terminalization, but chat turns, decisions, processes, cancellation, and failure still use separate state models. |

# My Agent Experience — Feature Status and Limits

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

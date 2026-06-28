# Architecture

The request path starts in `src/index.tsx`; session state, execution providers, and storage branch from there. Files appear below in dependency order.

| File | What it owns |
|---|---|
| `src/index.tsx` | Hono app composition plus non-session top-level routes. |
| `src/routes/sessions.ts` | Session CRUD, export, inbound injection, ticket routes, and conversation-attached artifact cleanup. |
| `src/check-in.ts` + `src/routes/check-in.ts` | Owner check-in read model over Attention, jobs, and run receipts. |
| `src/artifacts.ts` + `src/routes/artifacts.ts` | One-off Svelte artifact compile/storage path plus owner-scoped preview/index routes. |
| `src/auth.ts` | Verifies the Cloudflare Access JWT (when configured); attaches `identity` to the request context. |
| `src/agent.ts` | Active `MyAgent extends Think` Durable Object — native chat, tools, unified durable submissions via `runTurn`, D1 mirror hooks, invisible Session-backed memory. |
| `src/delegate-many.ts` | Static `delegate_many`: the canonical parent runs at most two concurrent, run-scoped read-only `ReadOnlyDelegateAgent` Think facets via official `runAgentTool`; children cannot delegate, retained agent-tool events/runs are evidence, and the parent owns synthesis. Later delegations opportunistically clear older terminal child runs. |
| `src/think-workspace.ts` | Adapts Think workspace tools to the real Sandbox `/home/user` workspace. |
| `src/notify.ts` + `src/push.ts` | Owner-scoped Web Push transport and agent-notification delivery. |
| `src/browser-tools.ts` | Cloudflare Browser Run `browser_open` tool and inline replay-receipt payload. |
| `src/routes/browser.ts` | Replay page and server-side Browser Run recording retrieval for rrweb playback. |
| `src/routes/mcp.ts` | Direct MCP coordinator: bounded Code Mode orchestration for owner chat sessions plus one explicit Run Receipt connected-laptop observation tool. |
| `src/saved-recipes.ts` + `src/routes/recipes.ts` | Owner-approved saved `work_code` recipes. They run only against an owned session, reuse the normal Work Code Mode bridge, and append start/terminal Run Receipt events. |
| `src/llm.ts` + `src/models.ts` | Model/provider routing helpers and the operator-controlled catalog used by Think agents. |
| `src/tools.ts` | Product-native tool allowlist plus host handlers used by Work Code Mode. |
| `src/work-tools.ts` | Unified `work_search` + `work_code` dispatcher over My AX Workspace, My Machine, and Cloudbox with location-tagged call receipts. |
| `src/cloudbox-tools.ts` | Optional bounded Cloudbox live-run adapter used behind `cloudbox.*`. |
| `src/jobs.ts` + `src/job-service.ts` + `src/recurring-job-run.ts` + `src/routes/jobs.ts` | Native recurring-prompt scheduling, shared owner-scoped CRUD/evidence service, and one terminalization path for scheduled/manual runs and owner-visible receipts. |
| `src/run-receipts.ts` + `src/routes/runs.tsx` | Shared owner-scoped Run Receipt event append primitive, v0 CRUD/events, and read-only board; events are explicitly appended, not automatically captured. |
| `src/connectors.ts` | Connector registry. Public engine ships empty; users add their own MCPs via Settings → Connectors. |
| `src/oauth-store.ts` | `OAuthClientDO` — per-user encrypted-at-rest OAuth token storage with proactive refresh. |
| `src/bridge.ts` | Mints scoped per-call tickets, attaches upstream auth, writes audit receipts. |
| `src/workspace.ts` | Workspace restore/snapshot orchestration around Sandbox backups. |
| `src/views/` | Server-rendered JSX shells: `Layout`, `ChatPage`. They render the `<head>` + Svelte 5 mount points that hydrate on load. |
| `proof/svelte/` | Svelte client: app shell, chat runtime, sessions, settings, connectors, Attention, and allowlisted result widgets. `delegate_many` results are grouped into at most two compact child snapshots (status, summary, attempts, bounded details). Agents 0.17.0 supports detached/background child runs and official progress frames, but this custom Svelte socket does not yet expose the EventTarget required by `useAgentToolEvents`; the UI therefore labels and renders retained raw tool output rather than claiming live progress. Reconnect/transcript replay reuses that output. Cancellation and child drill-in are omitted because the current parent route exposes no safe official action/navigation surface. |
| `migrations/` | D1 schema migrations. |

The chat surface has no hand-written `.js` files. Everything in `public/static/` is fonts, generated CSS, and brand assets.


## Runtime Topology

```
Browser
  │  HTTPS (Cloudflare Access JWT enforced at the edge, when configured)
  ▼
<your-host> (Worker `my-ax`)
  ├─→ USER_AGENT / UserAgent DO  ── one durable root per user
  │     └─→ MyAgent facets       ── per-session Think chat, recovery, submissions, memory
  │            │
  │            ├─→ OAuthClientDO  ── per-user encrypted OAuth bearers used to register native Agent.mcp tools
  │            ├─→ Sandbox DO     ── per-user My AX Workspace
  │            │      └─ /home/user → container-local workspace restored from R2 snapshots
  │            ├─→ Worker Loader  ── bounded Work Code Mode dispatcher
  │            │      ├─ workspace.* → My AX Workspace
  │            │      ├─ machine.*   → outbound Machinectl relay
  │            │      └─ cloudbox.*  → bounded Cloudbox live runs
  │            ├─→ D1 `my-ax-db` ── session registry, Think-turn mirror, snapshots, FTS memory, push subs, Attention, jobs, artifact index, run receipts
  │            ├─→ R2 uploads     ── owner-scoped image attachments + screenshot/Svelte artifact objects
  │            ├─→ Browser Run    ── public-page browser sessions + native rrweb recording receipts
  │            └─→ Models         ── curated operator-controlled models
  │
  ├─→ MachineHost DO            ── per-user outbound-connected physical laptop relay
  └─→ User-added MCP servers    ── native MCP tools forwarded per-user (Settings → Connectors)
```

## Bindings Reference

Wrangler bindings (see `wrangler.jsonc`):

| Binding | Type | Purpose |
|---|---|---|
| `AI` | Workers AI | Reasoning model calls (optionally routed through AI Gateway for observability) |
| `USER_AGENT` | Durable Object (`UserAgent`) | One durable root per user; owns conversation `MyAgent` facets |
| `OAUTH_CLIENT` | Durable Object (`OAuthClientDO`) | One instance per user — encrypted bearer vault feeding native `Agent.mcp` registrations |
| `MACHINE_HOST` | Durable Object (`MachineHost`) | One outbound-connected physical laptop relay per user |
| `SANDBOX` | Durable Object (`Sandbox` from @cloudflare/sandbox) | One container per user |
| `BACKUP_BUCKET` | R2 | Sandbox workspace backup archives |
| `DB` | D1 | Session registry, Think-turn mirror/FTS/export feed, workspace snapshot pointers, push subscriptions, attention, artifact metadata, manually appended run receipts |
| `AUDIT_KV` | KV | 90-day audit receipts written by `bridge.ts` |
| `BROWSER` | Browser Run binding | Hosted public-page browser sessions and native recording sessions for `browser_open` |
| `LOADER` | Worker Loader | Unified Work Code Mode plus optional deploy-approved MCP Code Mode. |
| `ASSETS` | Static assets binding | Serves `public/` (CSS, JS, fonts, brand) |
| `CF_VERSION_METADATA` | Version metadata | Worker version id surfaced in the Settings drawer |

`work_code` accepts at most `32 KiB` of generated source and gives the Dynamic
Worker a `30s` timeout with global outbound networking disabled. Host methods
can reach their configured providers; for example, `machine.shell` reaches the
connected laptop and `cloudbox.run_create` reaches Cloudbox.

## Storage Layout

**R2 backup bucket** holds Sandbox backup archives for `/home/user`. The runtime workspace remains container-local for fast scans and tool I/O; `src/workspace.ts` persists the latest backup id in D1 and restores it into a fresh sandbox.

**Think storage in `MyAgent`** is the source of truth for active native chat messages, stream recovery, durable/programmatic turns, and the per-user `memory` context block (long-lived facts/decisions/preferences the model writes via Session's auto-wired `set_context` tool). Owner/API injection and native recurring alarms both submit durable turns through Think's unified `runTurn({ mode: "submit" })` path. **D1** stores the owner-facing sessions registry, latest workspace snapshot pointer per user, push subscriptions, Attention, recurring jobs and job evidence, saved recipes, an indexed mirror of new Think turns used by `search_conversations`, `/entries`, and `/export`, the artifact index, and explicitly posted Run Receipt events. **R2 uploads** stores owner-scoped upload bytes plus persisted screenshot/Svelte artifact objects.

**KV `AUDIT_KV`** stores `bridge.ts` call receipts for 90 days. Each stored record includes caller, target, method, and timestamp; Work Code Mode calls use their own response envelope.

## Identity Flow

1. Browser hits the worker's hostname.
2. Cloudflare Access enforces SSO at the edge (when configured); on success, attaches a JWT.
3. `src/auth.ts` verifies the JWT against the JWKS, extracts `email`, attaches `identity` to the Hono context.
4. Every Worker route reads `c.get("identity").email` to scope operations.
5. The Sandbox container, the OAuthClientDO instance, and the D1 session rows are all keyed by `email`.

Production uses the verified Access JWT email as the owner key. Local development can supply `DEV_USER_EMAIL` only through the development configuration.

## OAuth Flow for a User-Added MCP Server

1. User visits Settings → Connectors → Add MCP server, pastes the upstream URL, Test, Save.
2. The Worker probes `/.well-known/oauth-authorization-server` to discover endpoints.
3. If the server advertises a `registration_endpoint`, the Worker mints a fresh client id via Dynamic Client Registration (RFC 7591).
4. `/api/connectors/<id>/authorize` redirects to the discovered authorization endpoint with PKCE + state.
5. User consents at the upstream provider.
6. Callback at `/api/connectors/<id>/callback` receives the auth code.
7. Worker exchanges code → access_token + refresh_token, stored encrypted in `OAuthClientDO`.
8. Every subsequent tool call mints a fresh `bridge.ts` ticket, attaches the bearer, and forwards.
9. Refresh happens server-side ~5 minutes before expiry; user never re-consents unless they explicitly disconnect.

## Owner HTTP Surfaces

Beyond the WebSocket (`/agents/my-agent/:id`) and the CRUD on `/api/sessions`, these owner-authenticated surfaces are worth calling out because they are the stable automation and check-in paths:

- **`GET /api/check-in`** — owner loop front door. Derives needs-owner, running, completed, and suggested steer groups from Attention, jobs, and run receipts without storing a new projection. Its ordered `buckets` are the stable owner-return read model: each bucket carries an exact total, capped samples/sample ids, and an optional `steer` so agents and the shell do not infer semantics from display labels or href strings. Raw API steers stay machine-readable while the shell maps them to rendered owner destinations such as `/attention`, `/runs`, and `/jobs`; rendered bucket links preserve the raw receipt href in `data-check-in-raw-href` for proof and debugging.
- **Attention owner return** — `src/routes/attention.ts` owns both the authoritative raw `GET /api/attention` receipt and the rendered `GET /attention` owner page. Both paths parse the same `kind`/`sessionId` filters and share `buildAttentionListFilter(...)`, so the owner-friendly destination and the machine-readable receipt stay aligned while Access middleware remains registered in `src/index.tsx`.
- **Rendered owner receipt links** — rendered owner pages that mirror raw API list receipts preserve active filters when linking back to the authoritative `/api/...` receipt. `/attention` preserves `kind`/`sessionId`, `/runs` preserves `status`, and `/jobs` preserves `status`, so owners can move between friendly pages and machine-readable receipts without losing the exact view context.
- **`POST /api/sessions/:id/inject`** — inbound steering. Validates ownership against `sessions.owner_email`, forwards to `MyAgent`, and enqueues a durable Think submission. Connected PWAs repaint the injected user turn and assistant response live.
- **`GET /api/sessions/:id/entries?after=<cursor>&limit=<n>`** — incremental outbound sync. Reads `conversation_entries` from D1 by monotonic entry id, returns chronological rows strictly after the cursor, and is safe to poll idempotently.
- **`GET /api/sessions/:id/export?format=json|markdown`** — durable full transcript download. Reads `conversation_entries` from D1 directly (no Sandbox spin-up), enforces ownership in SQL, and returns a `Content-Disposition: attachment` response.

## Memory Boundary

my-ax uses Think `Session`'s built-in `memory` context block. `MyAgent.configureSession` declares one writable block (`maxTokens: 2000`), a cached system prompt, and Hermes-style compaction at 100k estimated tokens. The model writes durable facts/decisions/preferences via Session's auto-wired `set_context` tool; each conversation runs as a `MyAgent` facet inside the user's one `UserAgent` root DO. There is no memory UI — the only product surface is talking to the agent.

## Browser and MCP Surfaces

- **Trusted inline widget registry** — `proof/svelte/tool-result-widgets.ts` classifies tool output into an explicit allowlisted Svelte renderer. It never accepts arbitrary component names, HTML, or iframe URLs from model-adjacent output. Unknown payloads fall back to inert raw text. For Svelte artifacts it accepts only same-origin `/api/artifacts/:uuid/preview` URLs and mounts them in an `allow-scripts` sandboxed iframe.
- **`create_svelte_artifact`** — a native Think tool for one-off, self-contained Svelte 5 UI requested by the user. The worker compiles source with `svelte/compiler`, stores an owner/session-scoped manifest in R2 with indexed D1 metadata, and returns the allowlisted inline-preview payload. The preview document is routed through the owner-scoped app endpoint, then executes in an `allow-scripts` sandboxed iframe without same-origin/cookie authority and with a locked-down CSP.
- **`browser_open`** — a native Think tool backed by Cloudflare Browser Run. It currently targets public/browser-visible URLs, returns rendered title/text-preview metadata, and persists a native recording session. The trusted inline tool card auto-mounts an embedded iframe pointing at an allowlisted same-origin `/browser/replay/:id?embed=1` route.
- **`work_search` / `work_code`** — the model-facing computer surface. One catalog and one bounded program span the persistent My AX Workspace, the connected physical machine, and optional Cloudbox runs. Child calls carry location, method, status, and duration metadata.
- **Recurring jobs** — `JobService` is the sole business boundary for list/create/update/pause/resume/run/delete/history. Every adapter supplies the verified owner; all reads and mutations scope SQL by that owner. Active updates create the replacement native schedule before persistence, cancel it if persistence fails, and retire the old schedule only after the new row is durable. `job_events` retains mutation/run evidence and idempotency keys bound repeated create/run requests.
- **`POST /api/mcp`** — a minimal MCP JSON-RPC coordinator for owner-scoped chat-session and recurring-job orchestration plus explicit Run Receipt observations; it is not a generic arbitrary-tool gateway.

## Durable Object History

Wrangler Durable Object migrations are append-only deployment history. Active bindings include the owner root, conversation facet, OAuth store, machine host, Sandbox, and direct-routed Voice agent. A temporary `LEGACY_MY_AGENT` binding remains solely for lazy migration of pre-facet sessions; access to it is gated by an owner-scoped D1 session row and it should be removed after a measured migration cutoff.

# My Agent Experience — feature matrix

A grounded product/status reference for **My AX**: a self-hosted personal agent operating environment on Cloudflare.

Status legend:

- ✅ **Shipped** — implemented and used in production.
- 🧪 **Proving** — implemented, but still being measured or hardened.
- ⚠️ **Partial** — useful today with a known product/reliability gap.
- ⏭ **Next** — planned work, not shipped.

## Product surface

| Area | Capability | Status | Current behavior / boundary |
|---|---|---:|---|
| Chat | Durable typed conversations | ✅ | Per-session `MyAgent` facets extend Cloudflare Think; messages, reasoning, tools, recovery, and compaction are native Think primitives. |
| Chat | Multi-turn conversation | ✅ | Turns continue in one canonical Think session. User messages persist before model execution so a stalled provider cannot erase the prompt. |
| Chat | Streaming recovery | ✅ | Think recovery + a 120s parked-stream watchdog; dead streams recover or terminalize visibly instead of spinning forever. |
| Chat | Type while waiting/offline | ✅ | Composer stays editable while a turn runs or the socket reconnects; only sending is gated. |
| Chat | Scroll-safe streaming | ✅ | Auto-scroll only while pinned; floating ↓ returns to the latest content. |
| Chat | Reasoning display | ✅ | Persisted Thinking blocks stream and replay. |
| Chat | Tool presentation | ✅ | Consecutive tools group together; elapsed timers, terminal historical states, and typed result widgets are supported. |
| Chat | Fork from message | ✅ | Owner-scoped transcript fork with an immediate progress spinner and redirect into the fork. |
| Sessions | Latest-session resume | ✅ | The latest durable conversation resumes by default; explicit New Chat starts blank. |
| Sessions | Full transcript after compaction | ✅ | Think keeps compacted model context; if D1 contains more user turns, the human view reconciles to the complete durable transcript. |
| Sessions | Fast conversation switching | ✅ | In-place WebSocket/session swap instead of a full page reload. Defensive reload fallback remains. |
| Sessions | Export and incremental feeds | ✅ | Owner-scoped Markdown/JSON export plus cursor-based D1 entries feed and durable session injection. |
| Sessions | Resume production battery | ✅ | `npm run prove:resume` covers auth, replay, compaction, interrupted tools, A→B→A switching, continuation, two tabs, artifacts, and reconnect-after-producer loss. |
| Presence | Socket liveness | ✅ | Client ping/server pong prevents healthy idle sockets from being force-reconnected and shown as permanently red. |
| Voice | Realtime voice in the same conversation | ✅ | A direct-routed Voice agent owns mic/STT/TTS and delegates turns by RPC into the canonical Think session. Uses Workers AI Flux STT + Aura TTS. |
| PWA | Mobile/desktop installed app | ✅ | Installable shell, offline fallback, theme support, app badges, deep links, and service-worker update handling. |
| PWA | iPhone keyboard/safe-area handling | ⚠️ | Keyboard-open footer padding is removed; keyboard-closed state uses safe-area + tuned visual clearance. Proven on current target device, but still device-sensitive. |
| PWA | Foreground Wake Lock | ✅ | Visible active turns request screen Wake Lock; release on idle/hidden. |

## Models and inference

| Capability | Status | Current behavior / boundary |
|---|---:|---|
| Curated model picker | ✅ | Kimi K2.6, GLM 5.1, Opus 4.8, GPT-5.5, Kindle Alpha API, and Mercury Alpha. Provider details remain outside product UI. |
| Workers AI models | ✅ | Kimi and GLM use the Workers AI binding. Kimi K2.7 was tested and removed after repeatable multi-turn stream parking. |
| Gateway models | ✅ | Opus, GPT, Kindle Alpha API, and Mercury Alpha use the configured model gateway; all current ids were live-probed before registration. |
| Stale-model self-healing | ✅ | Removed/unknown persisted model ids resolve to the default instead of failing every turn with `model_not_found`. |
| Full-tool parity | ✅ | Every selectable model receives the same server tool surface. |
| Vision inputs | ✅ | R2 uploads are rehydrated for vision-capable models; non-vision models receive an explicit omission guardrail. |
| Durable inference / no duplicate billing | ⏭ | Adopt Cloudflare AI Gateway durable resume / Think `durableBuffer` when publicly available. Do not build a parallel custom inference-buffer DO. |

## Tools, MCP, and work authority

| Capability | Status | Current behavior / boundary |
|---|---:|---|
| Unified work surface | ✅ | `work_search` discovers and `work_code` composes `workspace.*`, `machine.*`, and `cloudbox.*` in one bounded Dynamic Worker. Legacy direct computer handlers remain internal during migration, not model-visible. |
| User-added MCPs | ✅ | Probe/add/remove UI with per-user OAuth, Managed OAuth discovery, and Dynamic Client Registration when advertised. |
| MCP security | ✅ | Public HTTPS only; embedded credentials, loopback/link-local/private IPv4, and metadata redirects are rejected. Discovery has bounded timeout/retry. |
| Native MCP tools | ✅ | Connected MCP tools hydrate through the Agents SDK and appear directly to Think. |
| MCP Code Mode | 🧪 | Official `@cloudflare/codemode` composes only exact deploy-approved MCP read/query methods in a Dynamic Worker. Think retains MCP OAuth/session/call authority, native tools remain available, and an absent/invalid policy disables Code Mode. |
| Code Mode benchmark | ⚠️ | Simple 1–2 call tasks are faster natively; Code Mode reaches its first tool sooner but pays setup cost. Complex multi-call benchmark needs a clean, bounded rerun. |
| External coordinator MCP | ✅ | `/api/mcp` provides bounded owner-scoped session listing, inspection, injection, and Attention acknowledgement; no generic arbitrary-tool endpoint. |
| Human decisions | ✅ | `ask_user` creates an owner-scoped multiple-choice decision, sends a push, records a receipt, and injects the validated answer back into the originating Think session. |

## Cloud workspace and connected laptop

| Capability | Status | Current behavior / boundary |
|---|---:|---|
| My AX Workspace | ✅ | Persistent `/home/user` workspace per owner, exposed through native Think file tools and `workspace.*` Code Mode methods for files, processes, transforms, and previews. |
| Workspace durability | ✅ | Sandbox snapshots in R2 with a versioned latest pointer; restore failure stays degraded/retryable and cannot bless or snapshot empty state. |
| Sandbox runtime | ✅ | Cloudflare Sandbox SDK/image aligned on 0.12.1; lean base includes Python, uv/uvx, rg, curl, jq, sqlite3, and archive utilities. |
| Project toolchains | ⚠️ | Compilers were removed from the global base after registry upload failures. Project-specific toolchains must be installed explicitly/user-locally. |
| Connected laptop | ✅ | `machinectl` is outbound-only and explicitly user-controlled. It exposes shell, screenshots, mouse/keyboard, accessibility, auth health, and delegated harness sessions when enabled. |
| My Machine provider | ✅ | The live Machinectl catalog appears under `machine.*` inside `work_code`; no laptop credentials are placed in generated code. Authority remains terminal-equivalent and is not described as sandboxed. |
| Cloudbox provider | 🧪 | Optional `cloudbox.*` methods create bounded public-repository runs, read/write relative files, and execute commands with runner receipts. Durable owner-scoped Cloudbox Computers are not yet claimed. |
| Harness portability | ⚠️ | MCP/tool boundary is harness-agnostic; canonical chat runtime is currently Cloudflare Think. Local Pi/editor harnesses are optional delegated targets, not the core runtime. |

## Artifacts, browser, and generated UI

| Capability | Status | Current behavior / boundary |
|---|---:|---|
| Inline Svelte artifacts | ✅ | `create_svelte_artifact` compiles self-contained Svelte 5 source, stores owner/session-scoped manifests in R2+D1, and renders a sandboxed inline iframe. |
| Artifact fullscreen | ✅ | Inline artifacts can launch immersive fullscreen and close with Escape. |
| Decision widgets from push | ✅ | Push deep-links to a constrained interactive choice page with close/return controls; server validates choices before resuming the agent. |
| Browser Run | ✅ | `browser_open` uses Cloudflare Browser Run, captures screenshot/replay evidence, and renders an inline playable artifact. |
| Arbitrary authenticated browser automation | ⚠️ | Cloud Browser Run handles public/isolated browsing; authenticated local browser interaction requires explicit connected-laptop capability. |
| Reusable artifact editing/library | ⏭ | Artifacts are durable and listable, but there is no polished reusable library or revision workflow yet. |

## Attention, jobs, and ambient behavior

| Capability | Status | Current behavior / boundary |
|---|---:|---|
| Web Push | ✅ | Owner-scoped VAPID push works on installed iOS and desktop PWAs; tests fan out to every registered device. |
| Completion push while away | ✅ | Successful turn completion pushes only when no visible connection is viewing that session. Title carries prompt context; body carries the actual reply. |
| Attention inbox | ✅ | Durable owner-scoped activity items, unread count, app badge, and deep links. |
| Agent notification tool | ✅ | `notify_owner` lets the agent send owner-scoped actionable attention linked to the active session. |
| Recurring prompts/jobs | ✅ | Native per-DO schedules with run-now, pause/resume, delete, last-run/error state, and optional notification. |
| Durable `needs_input` lifecycle | ⚠️ | Decision runs are durable and resumable, but there is not yet one unified turn-state record covering `running/completed/needs_input/failed/cancelled` across all chat/jobs surfaces. |
| Quiet hours/preferences | ⏭ | Delivery works; category policy, quiet hours, and per-channel preferences are intentionally not yet productized. |
| Release/deploy notifications | ⏭ | Deploy wrapper verifies health but does not yet create a concise release Attention item. |

## Evidence, memory, and security

| Capability | Status | Current behavior / boundary |
|---|---:|---|
| D1 transcript mirror + FTS | ✅ | Full durable human transcript, search, exports, and recovery fallback. FTS query construction is sanitized against syntax crashes. |
| Invisible conversation memory | ✅ | Think Session `memory` context block persists across turns inside one conversation facet. Owner-wide recall comes from the D1 transcript/FTS projection; no false cross-facet claim. |
| Run Receipts | ✅ | Owner-scoped typed event ledger and read-only receipt pages. Decision responses and external acknowledgements create receipts. |
| Access identity | ✅ | Cloudflare Access JWT is the only trust principal; convenience headers cannot overwrite verified identity. |
| OAuth token storage | ✅ | Tokens encrypted at rest with `MASTER_KEY`; refresh keeps DCR client identity and uses bounded timeout/transient retry. |
| Push resilience | ✅ | Effect-based concurrent fan-out, per-send timeout, transient-only retry, expired endpoint pruning, VAPID relink detection, public-HTTPS endpoint validation, and no cross-owner endpoint reassignment. |
| Effect I/O substrate | ✅ | Stable `effect` core powers portal RPC, push delivery, MCP discovery, and token-refresh transport. Agents/Think lifecycle remains native rather than wrapped. |
| Deployment separation | ✅ | The tracked engine is generic; deployment-specific hosts, Access settings, model routes, connector catalogs, and secrets are injected outside the public tree. |
| Dependency posture | ✅ | npm is canonical; current Cloudflare Think/Agents/Voice/Shell/Sandbox/Worker tooling is intentionally kept near latest and production-probed after bumps. |

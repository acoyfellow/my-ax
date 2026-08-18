# Changelog

Progress on My Agent Experience is recorded here in date order, newest first. Each dated entry lists the features and changes that shipped that day.

The version stays `0.0.1`. It does not increment. The number is a deliberate stance, not a status. The real identity of each change is its commit hash. Each dated entry names the deployed revision.

## 2026-08-18

### Added

- Live client and server errors file one GitHub issue per fingerprint through `POST /api/errors`. Same fingerprint in 24h reuses the issue. Desk gets a card. No `triage:draft`.

## 2026-08-17

Public engine at `1582a2a`. Employee app deploy is separate (`deploy-employee.sh`). Lifecycle agents deploy is separate (`deploy-agents.sh`).

### Added

- Durable owner desk at `/?action=desk`. HTTP `GET/PUT /api/desk`, chat and MCP `desk_get` / `desk_upsert`, and `page.openDesk`. Cards store newest first. Omitted fields survive upsert. Open source keeps only `https` GitLab or GitHub hrefs. Decide may keep a same-origin path. Same-origin Open source hrefs store `null`.
- Lifecycle issue-to-PR path: HMAC hook, `TriageWorkflow` (comment, label, ready PR when `triage:draft` and `bot/issue-<n>` exist), `AuditWorkflow` (never merge). Hunt-only ticks: `agents/HUNT.md`.

### Fixed

- Desk Open source no longer stores `/?action=desk`. `www.github.com` hrefs are tested. Desk `status` approved/rejected/unknown is tested.
- Worker PR bodies use `Closes #<n>` and do not invent a Files list. Shared `bot/issue-draft` head is gone.
- Audit empty `files` / unknown `behindMain` is a finding, not a clean receipt. `labelIssue` posts once against a static allowlist.

## 2026-08-16

### Added

- Owner MCP control plane: `session_state`, `abort`, `workspace_write`, `artifact_list`, and `artifact_get` so a supervisor can inspect and steer without injecting a user turn. Chat agents can `get_artifact` to read stored Svelte source.

## 2026-08-15

Employee target at the notify-dedupe revision after this entry. Personal target is not deployed.

### Added

- Owner MCP now exposes `workspace_list` and `workspace_read` (also `codemode.workspaceList` / `workspaceRead`). Paths may use `/workspace/...` as an alias for `/home/user/...`. List and read are bounded; sandbox-down returns `{unavailable:true}` instead of throwing. Session `list_sessions` now includes `messageCount`, `created_at`, a truncated first user message, and honest `hasMore`/`cursor`.

### Fixed

- MCP portal hydration now reuses a stable server id (`ax-mcp`) so re-authorize does not mint a new Agents SDK client that re-runs upstream GitLab DCR.
- Workspace search skips `.my-ax/conversations` jsonl so grep no longer dumps entire tool-call transcripts.
- `manage_jobs` list is capped at 20 rows so the tool result is not truncated mid-record.
- Screenshots include a durable `workspacePath` under `/home/user/.my-ax/screenshots/` so the model can read the image file.
- Voice half-duplex re-arm after TTS is 180ms so end-of-turn listening returns faster.
- Workspace write rejects ephemeral paths such as `/bugs` and `/relay`. Only `/home/user/...` is durable; those writes now fail closed instead of returning a success receipt that is wiped on recycle.
- `cmux_observe` tails via `cmux_surface_tail` (falls back to `cmux_pi_tail`) so observe matches the live machine catalog.
- `page.*` fails immediately with `page_unavailable` when no live Chat tab is connected, instead of waiting 10s for a timeout.
- Voice mode: a same-session tap after disconnect now reconnects and starts the call instead of only preparing (the two-tap reconnect). Mid-turn spoken ack threshold is 800ms so work-in-progress audio starts sooner.
- Identical owner `notify_owner` / MCP `job.complete` events no longer create a new Attention row and push each time. `notifyOwner` now defaults a content fingerprint (`kind+title+body`) when the caller omits `dedupeKey`, so a retried campaign completion is one receipt, not three.

### Changed

- Slimmed `loops/SPEED.md` and the `/loop` prompt: one or two shareable features, 2–4 named scouts instead of a mandatory 6–12 swarm, Terrarium as a lever not the workplace. Refreshed `docs/loop/current-bet.yaml` (expired 2026-06-30) to walk-away-loop-2026-w33. Direction, release, and repository-standard docs stay as the deep references.

## 2026-08-11

Deployed to the employee target at revision `4debded` through the private deployment wrapper (`deploy-employee.sh`); the personal target is temporarily not deployed. Hostnames are deployment-specific and live in the private wrappers, not here. This entry lands a backlog of bounded, independently committed changes, each with its own tests. That crush is closed: items 02–09, 11, and 12 shipped here. Items 10 (secure third-party authorization) and 13 (Pi customization/import seam) stay deferred — both are owner-approval trust boundaries, not leftover chores.

### Added

- Added **bounded recurring jobs**: a recurring prompt job can now run once, a fixed number of times, or unlimited. A non-destructive migration adds persisted `max_runs`/`run_count`; each run is claimed atomically under a `run_count < max_runs` guard, the job auto-exhausts and cancels its own schedule on the final run, and receipts and the UI report consumed and remaining runs truthfully. `manage_jobs` accepts `maxRuns` (1 for once, null for unlimited).
- Added a **native public `web_search` tool** built on the Cloudflare Web Search binding. It is discovery-only (titles, absolute citation URLs, and snippets; it never opens result pages, executes page content, submits forms, or changes state), bounded by result and output-size caps with a `truncated` flag, drops results without a valid http(s) URL, and never leaks upstream credentials. It is separated from internal capability search and degrades to `web_search_unavailable` until the platform binding is enabled on the account.
- Added a **read-only `cmux_observe` machine observer**: it observes only (terminal tail plus already-approved JSON status) and never steers, restricted to allow-listed roots with tail-byte and surface caps (`truncated` when capped), secret redaction (`redacted` when masked), and a sha256 hash plus `observedAt` timestamp per observation for verifiable attribution.
- Added a **conversation entry sequence integrity check**: a non-destructive migration adds an entry sequence and `checkSequenceIntegrity` validates it on the conversation log and session routes.
- Added **workspace restore verification** (`verifyWorkspaceRestore`), which validates a restore against its backup id and directory and emits `workspace.restore_verified`.
- Added a **compaction summary** guard that prevents prior-context content from leaking across a transcript compaction, wired into session entries, assistant backfill, and the Chat transcript render.

### Fixed

- Fixed tool-argument handling to **coerce arguments consistently** across every execution surface (canonical tools, work tools, MCP Code Mode, and the Code Mode runtime), so a tool sees the same normalized arguments regardless of caller.
- Fixed transcript rendering to **dedup by stable identity** (`sourceId` then `id`, last-write-wins) with a deterministic order, removing duplicate and out-of-order messages.

### Changed

- Renamed `LOOP.md` to `loops/SPEED.md` to make room for additional named loop contracts; updated the docs index and the `/loop` prompt to match.

## 2026-07-23

Deployed to both supported targets at revision `6c8f7f0` through the private deployment wrappers (`deploy-personal.sh` and `deploy-employee.sh`). Hostnames are deployment-specific and live in the private wrappers, not here.

### Added

- Added a self-hosted documentation surface at `/docs`, served by the app. The surface has four intent paths: Start, Guides, Reference, and Concepts. It uses the app design tokens. Each `/docs/<slug>` subpage renders a repository `.md` file. In-repository `.md` links change to on-site `/docs/<slug>` links. The build step inlines the Markdown, because the worker has no file system.
- Added a "What makes it different" section to `/docs`. The section states six verified capabilities. Each capability was checked against the code. A red-team review through three lenses (capability security, operational truth, precise claims) removed every must-fix objection. The text uses Simplified Technical English. The text does not use the word "novel", banned phrases, or arrow glyphs.
- Added the **Page connector** (`page.*`): while an owner chat tab is connected, the agent can drive the owner's own browser session over the chat WebSocket — list/switch conversations, read health and the transcript tail, open Settings/Attention/Sessions, notify, and navigate. Each verb errors `page_unavailable` when no live tab is connected.
- Added **artifact self-registration** (page connector v2): an artifact created with `create_svelte_artifact` can self-register scoped tools on mount; the agent discovers them with `page.listArtifactTools()` and invokes them with `page.invokeArtifactTool({artifactId,name,args})`, parent-mediated and arg-validated. Tools are bound to the source window, capped (8 per artifact, 32 total), kept out of the default catalog, and become discoverable on the turn after the artifact is created — a live instrument built once and steered later (e.g. a Job Health Cockpit).
- Added the **Terrarium connector** (`terrarium.*`), replacing the retired `cloudbox` connector: `terrarium.spawn` waits for a verified receipt, `terrarium.spawn_background` returns a run id, `terrarium.status` checks a run. Runs execute in Terrarium's own containers under a bearer control token.
- Added an owner-scoped Check-in primitive: authenticated `GET /api/check-in` and MCP `my_ax_check_in` compose unread Attention, active recurring jobs, and recent run receipts into one compact “what needs me / what is running / what completed” response without adding storage.
- Added owner-visible, actionable Attention receipts for terminal recurring-job runs. Successful scheduled work now tells the operator to review the conversation, and failed scheduled work reports the failure and next action instead of requiring transcript inspection.
- Added owner-visible Attention receipts for terminal delegated child batches, so delegated work now returns through the same Check-in/Attention loop as recurring jobs instead of existing only as retained tool output inside the transcript.
- Added a mobile-safe fullscreen artifact exit affordance so generated interactive artifacts cannot trap the owner behind iframe focus or browser chrome.
- Added saved recipes: owner-approved `work_code` recipes stored in D1, runnable against a chosen session through the same Code Mode bridge, with each run recorded as a Run Receipt for Check-in.
- Added Settings CRUD for saved recipes so the owner can create, edit, enable/disable, delete, and test-run Code Mode recipes without treating them as a generic extension marketplace.
- Added an owner-visible, actionable Attention receipt when stalled-turn recovery is exhausted, linking back to the interrupted conversation with a truthful retry next action. Added an authenticated, self-cleaning operator probe that safely verifies the same terminal transcript, interrupted session state, and owner receipt contract without wedging a real model turn or sending a false incident alert.
- Added a searchable Capabilities Settings section explaining built-in and connected tools, memory, execution surfaces, and their authority boundaries.
- Added an owner-scoped “Clear all” action for Attention notification receipts; source conversations, jobs, and decisions are preserved.
- Rewrote the README around the current runtime, explicit authority and durability semantics, production-readiness steps, hard limits, and a seven-minute contributor map; incorporated adversarial operational, runtime-contract, and OSS onboarding review, and clarified the boundary between Agents SDK, Think, and My AX.
- Added bounded `delegate_many` using official Agents-as-tools: up to two concurrent run-scoped read-only Think children, structured retained results, typed failures, idempotent replay, cancellation, owner-gated drill-in, and TTL cleanup.
- Added a polished, replay-safe grouped delegation card with aggregate progress, task labels, accessible status rows, structured run metadata, mobile-safe details, and nested raw output; it truthfully renders retained terminal output until the Svelte transport exposes official live agent-tool events.
- Upgraded the Cloudflare runtime cohort to Think 0.10.0, Agents 0.16.2, Voice 0.3.2, and Code Mode 0.4.1 to enable the official Agents-as-tools delegation path.
- Added owner-scoped recurring-job management for the canonical agent, Code Mode, HTTP, and MCP: list, create, update/reschedule, pause, resume, run, delete, and durable history with idempotent create/run support.
- Upgraded the curated Workers AI catalog to Kimi K2.7 Code and GLM 5.2, with Kimi K2.7 Code as the default after production canary verification.
- Established this changelog as the durable record for notable changes going forward.
- Extended `LOOP.md` so an iteration cannot finish until the parent integrates, deploys, and records a production proof.
- Added balanced, hardening, product, UI, and simplification tracks, including research-grounded product discovery and browser-first UI acceptance criteria.
- Added bounded architectural refinement, progress tracking, live tests after significant steps, independent autoreview, and coherent parent-owned commits to the improvement protocol.

### Changed

- Reframed saved `work_code` reuse as **Reusable tools** across chat and Settings. Only successful code explicitly marked as broadly reusable can become a candidate; duplicate cards collapse within the loaded conversation while every tool receipt remains available. Owners can **Approve & enable** directly from chat, open the exact tool in Settings, or opt into owner-scoped automatic enablement and later review, disable, or delete tools. Review-first remains the default, direct approval is bound to the exact source, and host-bound Machine/Cloudbox code stays inline-only.
- Split Check-in unread receipts into actionable owner requests and informational updates while preserving the total unread count, capped samples, and failed-run visibility.
- Absorbed the Agents SDK v0.17.0 cohort by exact-pinning `agents@0.17.0`, `@cloudflare/think@0.11.0`, `@cloudflare/voice@0.3.3`, and `@cloudflare/codemode@0.4.2`; My AX keeps using Think's unified `runTurn({ mode: "submit" })` path for owner/API injection and native recurring alarms, and leaves detached/background sub-agent progress as a deliberate future UI/receipt adoption rather than a hidden behavior change.
- Raised explicit Work Code Mode and MCP Code Mode execution caps from 30s to 60s to match the current Code Mode runtime cohort.
- Promoted the single-root Svelte app to `/` (previously `/beta`), retiring the legacy multi-mount `ChatPage`; `/beta` remains a one-release alias.

### Documentation

- Rewrote `SECURITY.md` from a report stub into a posture document. The document states the trust model, the identity and authentication path, the outbound-only network posture, the capability boundaries, and an honest statement of the machine companion. The document adds a "what it does not do" section and an empty compliance-mapping table for the deploying team. The document makes no invented compliance claim. The posture is shown at `/docs/security`.
- Reframed the README and documentation copy away from remote-access-tool language. The new frame everywhere: a single-operator agent that acts with the owner's own authority. It is not a remote-access tool. It takes no inbound connection. The owner authorizes each action.
- Rewrote the documentation content in ASD-STE100 Simplified Technical English: short sentences, one idea in each sentence, no banned phrases, and no arrow glyphs.

### Fixed

- Fixed `/api` connector-status 503 caused by an undecryptable stored OAuth token throwing in `atob()`: `decryptStoredSet` now fails soft (returns null, logs `oauth_token_decrypt_failed`) and is treated as unauthorized.
- Stripped inert dev-only probe routes (`dev-page-call`, `dev-work-code`) that were terraloop scaffolding.
- Hardened conversation switching, transports, receipts, notifications, delegation backpressure (3021), push delivery, uploads, and error reporting across a sustained review pass: fail-closed guards, Unicode-safe truncation, tightened validation, and deterministic tests, with no change to documented behavior.
- Protected every rendered Attention subroute with the Access identity middleware, restoring the owner-scoped “Mark this view seen” action without weakening its same-origin check.
- Added a release and CI guard that fails if stale pre-Recipes API or agent-facing surfaces reappear in user/agent-facing source or generated assets, preventing another Recipes rename deploy regression.
- Reopened a human decision and removed its provisional answer event when delivery to the canonical Think session fails, returning retryable `DECISION_RESUME_FAILED` instead of falsely reporting that the conversation resumed.
- Rejected conversation-entry pagination cursors outside JavaScript’s exact integer range instead of querying from a precision-lost boundary.
- Claimed human decision responses with a conditional state transition so concurrent submissions cannot retain conflicting answer events or resume the source conversation twice.
- Unified the Settings modal’s search, keyboard controls, navigation, borders, radii, spacing, colors, and responsive scrolling into one coherent visual system.
- Failed recurring-job creation closed when the native scheduler does not return a durable schedule ID, allowing the existing compensation path to remove provisional state.
- Prevented wide conversation content from moving the vertical scroller horizontally, while keeping code blocks and tables locally scrollable, and rendered Markdown during streaming as soon as the parser loads instead of waiting for syntax-highlighting modules and turn completion.
- Made fresh browser state select the documented Workers AI default instead of an unconfigured gateway model, and aligned the root API product version with `0.0.1`.
- Made fresh self-host setup account-explicit and reproducible: multi-account Wrangler sessions can be pinned, new installations receive one current Durable Object baseline instead of replaying an invalid historical add/delete chain, and independent deployment boundaries are documented.
- Removed a stale undefined connector-refresh call that could break terminal chat-response handling after a turn completed.
- Kept the Attention unread badge authoritative when only the newest page is marked seen, including concurrent arrivals and failed seen requests.
- Made the expanded conversation drawer’s “New conversation” primary action explicit, full width within its padded container, centered, and at least 40px high.
- Restored package metadata to `0.0.1`; development changes do not increment the project version.
- Updated Wrangler to 4.102.0, removing the current `ws` and `undici` security advisories from the development dependency tree.

### Changed

- Collapsed the My AX coordinator MCP Code Mode adapter map into one source of truth so `my_ax_code` bindings cannot drift from the `my_ax_call` method catalog.
- Collapsed recurring-job terminal persistence and owner receipt emission into one shared path used by both native scheduled alarms and manual “Run now,” removing the drift that previously let one path update job state without producing the owner-visible completion receipt.
- Made `/loop` a project Pi prompt template and kept orchestration in Pi plus Terrarium MCP/extension rather than a duplicate repository-local scheduler. The repository contract now runs one meaningful user-outcome iteration through parent integration, deployment, proof, repair/rollback, and a plain-language release summary.
- Made observable user benefit a hard loop eligibility/completion gate: a writer cannot start without a named user journey, observed problem, expected change, production measure, and discovery surface; a changed iteration cannot complete without revision-bound production proof and a plain-language release summary.
- De-narrated the stylesheet header comments to describe current behavior instead of past migrations.
- Removed misleading comments and dead code that degraded the seven-minute repository, with no behavior change: corrected the OAuth-store header to describe the actual AES-GCM-256 encryption-at-rest, deleted the no-op `oauth-store-facade.ts` and the `sandbox.ts` shim in favor of single canonical owners, removed an unreachable duplicate liveness-ping branch and the unused standalone Cloudbox tool exports, and rewrote war-story comments as present-tense invariants.

### Security

- Centralized a fail-closed public-HTTPS destination policy and applied it at every credentialed/server-side outbound use site: OAuth dynamic client registration, token exchange, and refresh now revalidate persisted endpoints immediately before each request, and the connector bridge builds upstream URLs with `new URL()`, requires the resolved request to stay on the registered connector origin before attaching the bearer token, and refuses redirects. (Strict URL/host/origin enforcement; not DNS-resolution pinning.)

### Fixed

- Stopped recurring-job actions in Settings from reporting false success: Run, Pause, and Delete now check the HTTP response, surface an accessible inline error on failure instead of always claiming success, and disable their button while a request is in flight to prevent duplicate run/pause/delete.
- Made recurring jobs survive crashes and partial scheduler failures: a manual idempotent run now holds a 5-minute lease so a run interrupted mid-dispatch can be retried instead of being stuck `pending` forever, and a job update whose old-schedule cancellation fails now keeps its live replacement schedule (recording the possibly-orphaned old alarm) instead of rolling back to a cancelled schedule and leaving the job silently inactive.

### Security

- Made run receipts record only observed events: removed the synthetic `coordinator.plan.created` event that asserted a live coordinator plan at run creation, stamped event timestamps with server-observed time instead of trusting caller-supplied values, and rejected event appends and stop transitions against a terminal run with a `RUN_TERMINAL` (409) error.
- Rejected malformed raster artifact identifiers before owner-scoped R2 lookup by requiring an RFC 4122 UUID shape.
- Failed session message injection closed when D1 ownership verification is unavailable instead of resolving the session facet through a best-effort fallback.
- Rejected literal special-purpose IPv4 destinations used for protocol assignment, documentation, and benchmarking from the shared fail-closed public URL policy.
- Required an owner-scoped D1 session row before resolving or mutating a session facet’s model configuration, failing closed on missing, foreign, or unavailable ownership state.
- Bound direct Voice actors to the authenticated owner and rejected missing or foreign session IDs before seeding or routing Voice state.
- Rejected carrier-grade NAT destinations in `100.64.0.0/10` from public URL validation.

## 2026-06-19

### Security

- Rejected the IPv6 unspecified address (`::`) in public-URL validation so it cannot be treated as a public destination.
- Made MCP Code Mode fail closed when connector or method names sanitize to empty identifiers.
- Encoded client-provided upload session IDs as a single R2 key segment, preventing traversal-like IDs from producing keys that fail owner validation and cannot be retrieved.

### Tests

- Added regression coverage for adversarial upload session IDs and included it in the unit suite.

## 2026-06-18

### Added

- Added `LOOP.md`, a bounded `SEARCH → FIX → VERIFY → HANDOFF` protocol for evidence-backed continual improvement with one Terrarium writer at a time.
- Expanded the feature matrix with a current shipped/partial/planned inventory and dependency roadmap.

### Fixed

- Refreshed pending decision state after active tool output and service-worker attention messages, keeping decision banners synchronized without a reload.
- Made recurring-job resume idempotent so repeated resumes preserve one schedule and persistence failures compensate by cancelling newly created schedules.
- Prevented delayed session-history work from overwriting, loading, or raising errors in a newer active session after a session switch.
- Replaced randomized workspace snapshot ordering with monotonic publication generations so an older snapshot cannot remain canonical.
- Preserved successful connector responses when audit KV persistence is unavailable; the audit failure is logged without forcing an unsafe retry of a consumed bridge ticket.

### Security

- Made connector bridge tickets single-use and rejected replay before a second upstream call.

### Tests

- Added focused regression suites for bridge-ticket replay, recurring-job transitions, session-generation races, workspace snapshot ordering, and audit-storage failure.

## 2026-06-17

### Added

- Published the initial public My AX source tree, including the Think-based agent, voice integration, durable workspace, connectors, jobs, artifacts, push, browser tools, and deployment configuration.
- Added an inline deployed-run demonstration and dark-mode product imagery to the public documentation.

### Fixed

- Made notification deep links navigate correctly when the PWA is already open instead of leaving the warm client on stale state.

### Documentation

- Reworked the README and documentation around the implemented product, architecture, deployment path, local development, patterns, proof surfaces, and public setup.
- Simplified the public entry point and tightened `scripts/setup.sh` guidance.
- Consolidated the media presentation to one deployed product demonstration.

[2026-06-19]: https://github.com/acoyfellow/my-ax/compare/0445d35...2700e58
[2026-06-18]: https://github.com/acoyfellow/my-ax/compare/8324032...0445d35
[2026-06-17]: https://github.com/acoyfellow/my-ax/commits/8324032

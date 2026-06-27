# Changelog

Notable changes to My Agent Experience are recorded chronologically here.

My AX remains version `0.0.1` while it is being built. These dated sections are development history, not versioned releases.

## [Unreleased]

### Added

- Added an owner-scoped Check-in primitive: authenticated `GET /api/check-in` and MCP `my_ax_check_in` compose unread Attention, active recurring jobs, and recent run receipts into one compact “what needs me / what is running / what completed” response without adding storage.
- Added owner-visible, actionable Attention receipts for terminal recurring-job runs. Successful scheduled work now tells the operator to review the conversation, and failed scheduled work reports the failure and next action instead of requiring transcript inspection.
- Added owner-visible Attention receipts for terminal delegated child batches, so delegated work now returns through the same Check-in/Attention loop as recurring jobs instead of existing only as retained tool output inside the transcript.
- Added a mobile-safe fullscreen artifact exit affordance so generated interactive artifacts cannot trap the owner behind iframe focus or browser chrome.
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

- Absorbed the Agents SDK v0.17.0 cohort by exact-pinning `agents@0.17.0`, `@cloudflare/think@0.11.0`, `@cloudflare/voice@0.3.3`, and `@cloudflare/codemode@0.4.2`; My AX keeps using Think's unified `runTurn({ mode: "submit" })` path for owner/API injection and native recurring alarms, and leaves detached/background sub-agent progress as a deliberate future UI/receipt adoption rather than a hidden behavior change.
- Raised explicit Work Code Mode and MCP Code Mode execution caps from 30s to 60s to match the current Code Mode runtime cohort.

### Fixed

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

## [2026-06-19]

### Security

- Rejected the IPv6 unspecified address (`::`) in public-URL validation so it cannot be treated as a public destination.
- Made MCP Code Mode fail closed when connector or method names sanitize to empty identifiers.
- Encoded client-provided upload session IDs as a single R2 key segment, preventing traversal-like IDs from producing keys that fail owner validation and cannot be retrieved.

### Tests

- Added regression coverage for adversarial upload session IDs and included it in the unit suite.

## [2026-06-18]

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

## [2026-06-17]

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

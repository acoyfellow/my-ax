# Changelog

Notable changes to My Agent Experience are recorded chronologically here.

My AX remains version `0.0.1` while it is being built. These dated sections are development history, not versioned releases.

## [Unreleased]

### Added

- Added bounded `delegate_many` using official Agents-as-tools: up to two concurrent run-scoped read-only Think children, structured retained results, typed failures, idempotent replay, cancellation, owner-gated drill-in, and TTL cleanup.
- Upgraded the Cloudflare runtime cohort to Think 0.10.0, Agents 0.16.2, Voice 0.3.2, and Code Mode 0.4.1 to enable the official Agents-as-tools delegation path.
- Added owner-scoped recurring-job management for the canonical agent, Code Mode, HTTP, and MCP: list, create, update/reschedule, pause, resume, run, delete, and durable history with idempotent create/run support.
- Upgraded the curated Workers AI catalog to Kimi K2.7 Code and GLM 5.2, with Kimi K2.7 Code as the default after production canary verification.
- Established this changelog as the durable record for notable changes going forward.
- Extended `LOOP.md` so an iteration cannot finish until the parent integrates, deploys, and records a production proof.
- Added balanced, hardening, product, UI, and simplification tracks, including research-grounded product discovery and browser-first UI acceptance criteria.
- Added bounded architectural refinement, progress tracking, live tests after significant steps, independent autoreview, and coherent parent-owned commits to the improvement protocol.

### Fixed

- Kept the Attention unread badge authoritative when only the newest page is marked seen, including concurrent arrivals and failed seen requests.
- Made the expanded conversation drawer’s “New conversation” primary action explicit, full width within its padded container, centered, and at least 40px high.
- Restored package metadata to `0.0.1`; development changes do not increment the project version.
- Updated Wrangler to 4.102.0, removing the current `ws` and `undici` security advisories from the development dependency tree.

### Security

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

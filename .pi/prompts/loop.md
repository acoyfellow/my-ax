---
description: Research current agent/runtime work, then run My AX improvements through production proof
argument-hint: "[focus]"
---
Read `LOOP.md` completely and execute it${1:+ with focus: $@}.

For a normal `/loop`, keep going until there are two meaningful and exciting product features to share, each integrated, deployed, and production-proved. If the focus explicitly asks for one bug/security/reliability fix, execute one proved iteration only.

You may use candidate batch mode: fan out isolated research/prototype candidates, collect harvest receipts, reconcile adversarially, then land selected features sequentially. Candidate branches are evidence, not merge targets.

When spawning Terrarium candidates, pin an explicit currently working runner/agent (for example `pi -p --no-session`) and include a task contract requiring `task_status` plus `harvest_receipt`; do not rely on stale runner defaults or assume My AX app models are Terrarium runner models.

Before selecting work, perform the `LOOP.md` research phase: current external OSS/product scan, Cloudflare/internal/dependency context via `cfi` when relevant, and local My AX evidence. If no candidate has a concrete user benefit and production measure, return no-change.

You are the parent controller in this Pi conversation:
- verify the clean checkout and starting revision;
- use read-only scouts or isolated candidate agents for research/prototyping when helpful, but exactly one landing writer at a time;
- use Terrarium MCP for at most one isolated writer child when a change is selected;
- after a background spawn, do not sleep or busy-poll; the Pi Terrarium extension will resume this conversation on terminal callback, with known-run status as fallback;
- independently review and verify the child patch;
- integrate, deploy through the owner wrappers, and prove the exact user outcome;
- continue bounded repair or rollback until proof passes; do not stop at a transient `needs_operator` once the operator provides direction;
- after each proved feature, decide whether the run has two shareable product features; continue if not;
- finish with research digest, harvest/reconciliation summary, and plain-language release summaries required by `LOOP.md`.

---
description: Research current agent/runtime work, then run My AX improvements through production proof
argument-hint: "[focus]"
---
Read `LOOP.md` completely and execute it${1:+ with focus: $@}.

For a normal `/loop`, keep going until there are two meaningful and exciting product features to share, each integrated, deployed, and production-proved. If the focus explicitly asks for one bug/security/reliability fix, execute one proved iteration only.

This is a mandatory speed-first Terraloop. Create a recurring `loops_task` driver and use Terrarium in the same campaign. Fan out every independent atom with `terrarium_spawn_batch`; default to 6–12 bounded scouts/critics and 2–4 disjoint isolated prototype lanes when that many real atoms exist. Collect harvest receipts, reconcile once per round in `.context/loops/myax-speed-terraloop/STATE.md`, then land shared-file integration and production mutations sequentially. Candidate branches are evidence, not merge targets. Sequential work requires a recorded concrete dependency; convenience and token conservation do not qualify.

When spawning Terrarium candidates, first run a tiny runner canary/dry-run to prove the selected command/model does not inherit stale defaults. Pin an explicit currently working runner/agent/model and include a task contract requiring `task_status` plus `harvest_receipt`; do not assume My AX app models are Terrarium runner models. Check for unrelated active writers before fanout.

Before selecting work, perform the `LOOP.md` research phase: current external OSS/product scan, Cloudflare/internal/dependency context via `cfi` when relevant, and local My AX evidence. If no candidate has a concrete user benefit and production measure, return no-change.

You are the parent controller in this Pi conversation:
- verify the clean checkout and starting revision;
- use parallel read-only scouts, critics, proof designers, and isolated candidate writers by default; permit concurrent writers only with disjoint file/state ownership, while keeping exactly one parent-controlled landing/integration lane;
- use Terrarium MCP batch fanout for all independent work and a single child only for a truly indivisible dependency or final independent stop audit;
- after a background spawn, do not sleep or busy-poll; the Pi Terrarium extension will resume this conversation on terminal callback, with known-run status as fallback;
- independently review and verify the child patch;
- integrate, deploy through the owner wrappers, and prove the exact user outcome;
- continue bounded repair or rollback until proof passes; do not stop at a transient `needs_operator` once the operator provides direction;
- after each proved feature, decide whether the run has two shareable product features; continue if not;
- before completion, require a fresh independent read-only Terrarium stop-gate audit to return PASS; then write the final receipt and delete the exact recurring `loops_task` immediately;
- finish with research digest, harvest/reconciliation summary, exact run IDs, serialization reasons, and plain-language release summaries required by `LOOP.md`.

# My AX improvement loop

This is the hot-path contract for a scheduled My AX improvement controller.
Detailed policy lives in [`docs/loop/`](docs/loop/).

## Purpose

Improve one weekly user outcome through small, evidence-backed changes. A ten-minute tick is a **reconciler**, not a request to invent new work.

```text
RECONCILE → (when idle and permitted) FIND → CHANGE → VERIFY → REPORT
                                         parent: REVIEW → RELEASE → SOAK → PROVE
```

## Tick contract

On every tick:

1. Run `npm run loop:status` and acquire the durable controller lease.
2. If an iteration is nonterminal, advance or reconcile only that iteration.
3. If a child is known, query its run ID; callbacks are terminal pull notifications, not authority and not wakeups.
4. If the checkout is dirty, compare it with the recorded baseline and owned patch digest. Adopt only a known iteration-owned diff; otherwise enter `needs_operator` without stashing, resetting, or cleaning.
5. Start new search only when state is `idle`, no candidate awaits release/proof, the circuit is closed, and budgets permit it.
6. Release the lease after persisting the new state.

Never infer completion from elapsed time, process exit, a callback, the latest deployment, or a clean health check alone.

## Direction

- Every changed iteration must improve an observable user outcome. Reliability, security, and simplification qualify only when they protect a named user journey or remove measured friction.
- Work must support the current weekly bet in [`docs/loop/direction.md`](docs/loop/direction.md), remove a blocker to it, or address an explicit production/security incident with a named affected journey.
- Before launching a writer, persist `userOutcome`: user, journey, observed problem, expected change, production measure, and discovery surface.
- Rank evidence once daily. Do not repeat broad discovery every ten minutes.
- One child owns one finding in an isolated worktree.
- If the honest answer to “what changes for the user?” is weak, return no-change and route the idea to ordinary maintenance.

## Child: FIND → CHANGE → VERIFY → REPORT

### FIND

Freeze one finding before edits: stable ID, structured user outcome, reproduction/evidence, scope, acceptance criteria, proof plan, and smallest intervention. The controller refuses `selecting → child_running` until this gate is complete.

### CHANGE

Make the smallest coherent fix. Add an observable regression test where practical. Remove only code or docs made obsolete by the change. Preserve the invariants below.

### VERIFY

Run the narrow proof, then `npm run verify:changed`. Review the final diff once for scope, stale paths, and data leakage. Report flakes and failures; never weaken a boundary to pass.

### REPORT

Return: finding/evidence, files changed and patch digest, commands/outcomes, remaining risks, and parent next action.

## Authority and invariants

- The controller owns state and leases. One child is the only writer in its isolated worktree.
- A child may inspect, edit, and test locally. It must not commit, push, migrate, deploy, access production, rotate credentials, or mutate external services.
- Think's `MyAgent` is canonical for text and voice.
- Production requires Cloudflare Access; only explicit dev mode may bypass it.
- Public source contains no deployment identity, private hosts, account IDs, Access details, secrets, or private history.
- Generated Code Mode receives callable capabilities, never raw credentials or ambient authority.
- D1 is the human/search/export projection; Think owns execution/model state.
- Restore and ownership checks fail closed. Never print, persist, or commit credentials.

## Parent: REVIEW → RELEASE → SOAK → PROVE

The parent validates the exact patch digest, reruns the narrow proof, and runs `npm run verify:release` before integration. Release only inside the budgets and gates in [`docs/loop/release.md`](docs/loop/release.md).

Production completion requires proof bound to the exact revision and deployment ID. A changed iteration also requires a plain-language release summary: title, user benefit, required action, and discovery surface. Failed proof triggers bounded repair or rollback; it never starts a new finding. Demo/media work is optional after production certification and cannot block operational completion.

## State and recovery

The authoritative local controller record is `.my-ax-loop/state.json`, managed by `npm run loop:state -- …`. Its schema, transitions, blocker codes, callback validation, leases, and crash recovery are defined in [`docs/loop/state-schema.md`](docs/loop/state-schema.md).

Open the circuit and enter `needs_operator` when ownership, state, checkout baseline, callback identity, deployment identity, rollback, or budgets are ambiguous.

## Canonical cadence

- Every 10 minutes: reconcile state only.
- Up to 4 searches and 3 writer children per day.
- Up to 1 production release per day (2 only with explicit operator approval).
- No unattended production mutation or irreversible migration.
- Daily: evidence ranking and operator summary.
- Weekly: choose one product bet, groom blockers, and rehearse rollback.

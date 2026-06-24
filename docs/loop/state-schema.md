# Loop controller state

The controller owns one local record at `.my-ax-loop/state.json`. It is operational state, not source history, and is ignored by Git. Every update increments `generation`; a controller must compare the generation it read before writing.

## States

```text
idle
  → selecting
  → child_running
  → child_completed
  → parent_review
  → locally_verified
  → queued_for_release
  → deploying
  → soaking
  → proving
  → production_certified
  → complete
```

Recovery states:

```text
any nonterminal → retry_wait → resume_state
any nonterminal → needs_operator

deploying | soaking | proving
  → rolling_back
  → rollback_proving
  → rolled_back
  → needs_operator (if rollback fails)
```

`complete` and `rolled_back` are terminal and monotonic. A later regression creates a new incident/finding.

## Required record

```json
{
  "version": 1,
  "generation": 1,
  "fencingToken": 0,
  "iterationId": null,
  "findingId": null,
  "weeklyBetId": null,
  "state": "idle",
  "resumeState": null,
  "stateEnteredAt": "RFC3339",
  "updatedAt": "RFC3339",
  "repository": {
    "path": null,
    "startRevision": null,
    "baselineStatusHash": null,
    "ownedFiles": [],
    "patchDigest": null
  },
  "lease": null,
  "child": null,
  "attempt": 0,
  "notBefore": null,
  "blocker": null,
  "candidateRevision": null,
  "deployment": null,
  "proof": null,
  "rollback": null,
  "budget": {
    "date": "YYYY-MM-DD",
    "searches": 0,
    "writers": 0,
    "deployments": 0,
    "browserProofs": 0
  },
  "circuit": { "state": "closed", "reason": null },
  "events": []
}
```

## Lease

```json
{
  "id": "uuid",
  "holder": "controller-instance-id",
  "purpose": "reconcile|writer|integration|deploy",
  "fencingToken": 1,
  "acquiredAt": "RFC3339",
  "heartbeatAt": "RFC3339",
  "expiresAt": "RFC3339"
}
```

Only the current fencing token may mutate controller state. Fencing tokens increase monotonically across release/reacquisition. Controllers renew with `heartbeat <holder> <leaseId>` and release with `release <holder> <leaseId>`; an older instance cannot act on a newer lease that reuses the holder name. Lease expiry does not authorize a second canonical-checkout writer: first reconcile the known child/process/worktree and enter `needs_operator` if ownership is uncertain.

A short critical-section lock protects atomic state-file replacement. Locks older than 30 seconds are treated as abandoned; long-running ownership is represented by the lease, not the lock directory.

## Controller commands

```text
npm run loop:init
npm run loop:status
npm run loop:validate
npm run loop:tick
npm run loop:state -- acquire <holder> <purpose> [ttlSeconds]
npm run loop:state -- heartbeat <holder> <leaseId> [ttlSeconds]
npm run loop:state -- transition <generation> <from> <to> [reason] [actor]
npm run loop:state -- set-bet <generation> <betId> [actor]
npm run loop:state -- circuit <generation> <open|closed> [reason] [actor]
npm run loop:state -- archive <generation> [actor]
npm run loop:state -- release <holder> <leaseId>
```

## Child and callback contract

Persist launch intent and an idempotency key before spawning. A callback is accepted only when all hold:

- iteration ID and generation match;
- run ID and task fingerprint match the persisted child;
- callback event ID has not been consumed;
- receipt schema and task contract validate;
- start revision matches;
- isolated patch exists and its digest matches;
- state permits `child_completed`.

Missing callbacks are reconciled by querying the known run ID. Never launch a replacement merely because a callback did not wake the controller.

## Dirty checkout

At iteration creation, record HEAD, porcelain-v2 status, untracked inventory, and a baseline hash. Child edits belong in an isolated worktree.

- A patch matching the stored digest and owned-file set may be adopted.
- Unknown or mixed changes enter `needs_operator(code=unknown_checkout_mutation)`.
- Never automatically stash, reset, clean, or overwrite.

## Blocker codes

Use explicit blockers with `owner`, `detail`, `resumeState`, `retryAfter`, and `maxAttempts`:

```text
dirty_checkout
unknown_checkout_mutation
child_missing
child_inconclusive
callback_mismatch
verification_failed
flaky_test
rate_limited
credentials_unavailable
deploy_failed
proof_failed
rollback_failed
budget_exhausted
incident_freeze
state_corrupt
```

## Side-effect idempotency

Commit, push, deploy, proof, and rollback operations each receive a stable idempotency key derived from iteration ID, generation, state, and candidate revision. After a crash, query the remote system by immutable revision/deployment ID before retrying.

## Event log

Each transition appends a bounded event containing prior/new state, generation, actor, reason, timestamp, and evidence references. Keep detailed logs outside the state record; the record contains references and recent events only.

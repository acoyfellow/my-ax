# Loop release, proof, and rollback

Release is a parent-owned workflow separate from child iteration work.

```text
REVIEW → INTEGRATE → RELEASE → SOAK → PROVE → COMPLETE
                                  ↘ ROLLBACK → ROLLBACK PROOF
```

## Release budgets

Initial limits:

- at most 1 production release/day;
- a second release requires explicit operator approval;
- one candidate deployment/proof at a time;
- no unattended production mutation;
- no release during an incident freeze;
- no autonomous irreversible migration;
- minimum 30-minute soak for runtime changes unless an urgent security incident has an explicit shorter plan.

Compatible locally verified findings may be batched. Keep per-finding receipts and write one truthful release note for the deployed batch.

## Verification

Child runs the narrow proof and `npm run verify:changed`. Parent reruns the narrow proof and runs `npm run verify:release` before integration/release.

A proof plan is frozen with the finding and contains:

```text
exact candidate revision
expected deployment ID/source revision
user journey or API assertion
negative case when safe
relevant error/health signal
observation window
pass threshold
rollback threshold
```

A generic health check is not proof when the changed behavior can be observed directly.

## Pre-deploy rollback record

Before deployment, record:

```text
previous production Worker version ID
previous production git revision
candidate revision
migration classification: none | backward-compatible | irreversible
exact rollback command/surface
rollback owner
post-rollback proof journey/query
escalation if rollback fails
```

Employee production deploys only through the private wrapper's approved deployment script. The deployed version must be bound to the immutable candidate revision.

## Circuit breaker

Open the circuit and prohibit search/write/deploy when:

- production proof fails;
- rollback fails;
- two consecutive verification/release attempts fail;
- Access/authentication or required credentials are unavailable;
- rate limits persist beyond two bounded retries;
- ownership or deployment identity is ambiguous;
- daily budget is exhausted;
- incident freeze is active.

When the circuit is open, scheduled ticks may reconcile state and report status only.

## Retry policy

Each stage receives at most two automatic attempts with exponential backoff and jitter. Persist `attempt`, `not_before`, reason, and evidence. A third failure enters `needs_operator`.

Do not retry a push/deploy blindly. Query whether the exact revision/deployment already succeeded before repeating the external operation.

## Proof failure

A failed proof does not start another finding. It transitions to bounded repair or rollback. If repair changes the candidate revision, rerun release verification and deployment binding from the new revision.

## Rollback

Rollback is complete only when:

1. the selected prior version is active;
2. rollback proof passes;
3. production identity is recorded;
4. the failed candidate is marked rolled back;
5. an operator-facing incident/finding records the cause and next action.

An irreversible migration requires explicit operator approval and a forward-repair plan before deployment.

## Demo/media

Demo work is optional after production certification. Queue it separately for a user-visible release. Recording failure blocks publication, not operational completion. Tool-specific recording instructions live with the recording tool, not in `LOOP.md`.

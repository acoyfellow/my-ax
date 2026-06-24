# Loop release, proof, and rollback

Release is parent-owned and runs in the invoking Pi conversation after an accepted child patch.

```text
REVIEW → INTEGRATE → DEPLOY → PROVE → COMPLETE
                              ↘ REPAIR / ROLLBACK
```

## Integration

- Validate the exact child receipt and patch; callbacks wake the parent but do not authorize acceptance.
- Rerun the narrow proof and `npm run verify:release`.
- Update `CHANGELOG.md` without changing version `0.0.1`.
- Commit and push the accepted revision.

## Deployment

- One candidate deployment/proof at a time.
- Employee production deploys only through the private employee wrapper.
- Other installations deploy through their owner wrapper.
- Bind proof to the exact candidate revision and resulting deployment/version ID.
- No autonomous irreversible migration. Any irreversible migration requires explicit operator approval and a forward-repair plan.

## Production proof

Freeze the proof plan with the finding:

```text
exact candidate revision
expected deployment/source identity
user journey or API assertion
negative case when safe
relevant error/health signal
pass condition
rollback condition
```

Prefer a real authenticated journey. When inducing the negative case would harm a real conversation or user state, use a truthful self-cleaning operator probe that executes the same side-effect contract and verifies cleanup. A generic health check is not proof when the changed behavior can be observed directly.

A changed iteration cannot complete without:

1. production proof bound to the exact revision/deployment; and
2. a plain-language release summary naming the user benefit and discovery surface.

## Failure and repair

A failed proof does not start another finding and does not end the loop. Continue bounded repair within the frozen user outcome, or roll back. If repair changes the candidate revision, rerun release verification and deployment proof.

Do not blindly repeat push/deploy. Query whether the exact revision already succeeded before retrying an external operation.

## Rollback record

Before a risky deployment, record:

```text
previous Worker version ID
previous git revision
candidate revision
migration classification
rollback surface/command
post-rollback proof
operator escalation if rollback fails
```

Rollback is complete only when the selected prior version is active and its production proof passes.

## What’s new and demo

Every meaningful completed loop emits a structured user-facing summary. A Settings “What’s new” surface may consume those summaries later. Demo/video work remains optional after production proof and does not block operational completion.

# Product direction for the improvement loop

The loop compounds toward one weekly user outcome. It does not maximize iteration count.

## Weekly bet

Before write iterations begin, record one bet:

```yaml
id: short-stable-id
user: who is doing the work
problem: observed user problem
outcome: behavior that should become reliably true
metric:
  numerator: successful observed outcomes
  denominator: all relevant observed attempts
  target: measurable threshold
sources:
  - production receipt/query
  - direct dogfood journey
exclusions:
  - explicit non-goals
expires_at: YYYY-MM-DD
```

A finding is eligible only when it:

1. improves the weekly outcome;
2. removes a demonstrated blocker to it; or
3. addresses a production/security incident with higher urgency.

## Daily evidence ranking

Once per day, rank candidates from:

- direct My AX dogfooding;
- failed/stalled turns and recovery receipts;
- Attention and decision outcomes;
- recurring-job and delegation receipts;
- production errors and authenticated browser journeys;
- operator-reported friction;
- current Cloudflare primitive changes that can delete custom glue.

Each candidate needs a stable fingerprint, evidence link, user impact, confidence, estimated scope, proof plan, and disposition. Repeated triggers do not rediscover rejected or blocked candidates until their `deferred_until` condition changes.

## Candidate states

```text
candidate
selected
locally_verified
queued_for_release
blocked_external
deferred_until
rejected
done
```

Do not start broad search while a selected candidate awaits parent review, release, proof, or rollback.

## Product metrics

Prefer user outcomes over activity metrics. Examples:

- percentage of delegated/scheduled work ending in an actionable terminal receipt;
- percentage of decisions delivered exactly once to the originating conversation;
- percentage of stalled turns recovered or terminalized without manual transcript repair;
- median time from owner action to visible authoritative state;
- percentage of workspace mutations surviving restore.

Do not use number of findings, commits, deployments, tests, or videos as product success.

## Stop conditions

End the weekly bet early when:

- the target is met and sustained through a release soak;
- evidence disproves the user problem;
- the required authority violates product invariants;
- two interventions fail to improve the metric;
- an operator chooses a new higher-priority incident.

Weekly review records what changed in the metric, what was learned, and whether to continue, replace, or close the bet.

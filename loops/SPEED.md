# My AX improvement loop

A `/loop` campaign improves one owner-visible outcome, or returns no-change. It is a Terraloop: lock a contract, create a `loops_task` driver, use Terrarium only when a named lever applies. Do not restate the Terraloop protocol here.

## Stop

Stop when any of these is true:

1. One or two shareable features are integrated, deployed, and proved against the exact revision.
2. Research shows there is no bounded candidate worth doing, and the report says why.
3. 12 reconciled rounds or 24 hours have elapsed — emit no-change or a named blocker. Do not spin.

A shareable feature is a visible capability, a new owner-loop receipt, or a reliability change with a user-facing promise. Cleanup is not a feature.

```yaml
shareable_feature:
  one_sentence: what changed
  owner_visible_surface: check-in | attention | settings | chat | proof | other
  production_proof: exact command or journey
  owner_loop_delta: metric, new receipt, or newly possible action
```

A rejected idea leaves a `verified-disproved` receipt. That is a successful harvest.

## Select

Work must support [`docs/loop/current-bet.yaml`](../docs/loop/current-bet.yaml), remove a demonstrated blocker to it, or fix an urgent production/security incident with a named journey.

Before a writer starts, freeze:

```yaml
finding_id: stable-id
user: who benefits
journey: what they are trying to do
observed_problem: direct evidence
expected_change: what becomes possible, easier, safer, or more trustworthy
production_measure: how deployed behavior proves it
```

If “what changes for the user?” is weak, return no-change.

Research only as many independent atoms as you can name. Default is 2–4 read-only scouts (local evidence, production receipts, one external/internal scan). Do not fabricate scouts to hit a quota. Parent does cheap work. Spawn only for parallel, isolate, bound, context, or proof.

## Run

- Ride Terrarium callbacks. Do not sleep or poll.
- One writer per file set. Shared-file integration, push, deploy, and exact-revision proof are serial.
- Twice-stalled the same way → cancel and do that atom inline. Do not respawn a wedged runner.
- Parent verifies every child claim: re-read the file, re-run the cited test, grep the wiring. Exit 0 is not proof.
- Children do not git commit, push, deploy, or print secrets. They record `HEAD`.
- Reconcile each round in `.context/loops/myax-speed-terraloop/STATE.md` as: `round`, `runs`, `proven`, `next`. Unreconciled receipts cannot justify an edit or deploy.

## Land

Parent only, after a verified receipt:

1. `npm run verify:changed` (or the named narrow proof).
2. Update `CHANGELOG.md`. Version stays `0.0.1`.
3. Commit and push.
4. Deploy employee prod through the private wrapper. Other installs use their owner wrapper.
5. Prove the journey against that exact revision. A generic health check is not proof.

If proof fails, repair or roll back this finding. Do not start the next one.

```yaml
release_summary:
  title: plain-language change
  benefit: what is better for the user
  action: required action, or "No action required"
  visibility: whats-new | attention | direct | none
```

Before declaring the campaign done, one fresh read-only Terrarium auditor that did not author a landed patch returns `PASS`, `FAIL`, or `INCONCLUSIVE`. Retry an inconclusive auditor once. A second inconclusive result is a human blocker, not a third auditor. Then delete the `loops_task` driver.

## Invariants

- Think's `MyAgent` is canonical for text and voice.
- Production requires Cloudflare Access.
- Public source has no deployment identity, private hosts, account IDs, secrets, or private history.
- `machinectl` is outbound-only and user-controlled.
- Code Mode receives callable capabilities, never raw credentials.
- D1 is the human/search projection; Think owns execution state.
- Restore and ownership checks fail closed.
- Keep the seven-minute rules in [`docs/loop/repository-standard.md`](../docs/loop/repository-standard.md).
- Browser proof uses cmux or owner-authenticated My AX APIs. Standalone CDP is off unless the owner overrides.

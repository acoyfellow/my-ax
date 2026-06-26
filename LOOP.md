# My AX improvement loop

Invoke this contract with `/loop` (or an equivalent Pi prompt/tool invocation) to make one meaningful My AX improvement. Pi owns orchestration; Terrarium MCP may execute one isolated child; the Pi Terrarium extension resumes the parent on terminal callbacks. This repository does not run its own scheduler or workflow controller.

## Goal

Improve observable user outcomes, or return no-change. A normal `/loop` run aims to finish with **two meaningful and exciting product features to share**. A smaller single-fix run is allowed only when the focus asks for one bug/security/reliability repair.

```text
RESEARCH → SELECT → CHANGE → VERIFY → REPORT
parent: REVIEW → INTEGRATE → DEPLOY → PROVE → REPEAT/COMPLETE
```

A changed iteration is complete only after the exact deployed revision proves the user outcome and records a plain-language release summary. If proof fails, continue bounded repair or roll back; do not start another finding. A no-change iteration is valid when no candidate passes the user-outcome gate.

For normal `/loop`, stop only when either:

1. two changed, deployed, production-proved product features are ready to share; or
2. research and verification show there are not two bounded candidates worth doing, and the report explains why.

“Product feature” can be a visible capability, a new owner-loop receipt/proof, or a reliability improvement that creates a clearly shareable user-facing promise. It must not be generic cleanup disguised as a feature.

## Mandatory user-outcome gate

Before launching a writer, freeze:

```yaml
finding_id: stable-id
user_outcome:
  user: who benefits
  journey: what they are trying to do
  observed_problem: direct evidence of failure or friction
  expected_change: what becomes possible, easier, safer, or more trustworthy
  production_measure: how deployed behavior proves improvement
  discovery: direct | whats-new | attention | no-ui-needed
```

Every track passes this gate. Reliability, security, simplification, tests, refactors, dependency updates, and process work qualify only when they protect a named user journey or remove measured friction. If the honest answer to “what changes for the user?” is weak, return no-change and route the idea to ordinary maintenance.

Work should support the current bet in [`docs/loop/current-bet.yaml`](docs/loop/current-bet.yaml), remove a demonstrated blocker to it, or address an urgent production/security incident with a named affected journey.

## Child: RESEARCH → SELECT → CHANGE → VERIFY → REPORT

### RESEARCH

Before planning product work, gather current evidence from three directions:

- **External OSS/product scan** — inspect what active agent/runtime/workflow/browser/MCP projects are releasing today or recently. Prefer concrete release notes, commits, issues, demos, or docs over vibes. Look especially for ideas My AX can absorb in one loop: clearer receipts, better check-in, safer delegation, browser proof, capability manifests, model/provider reliability, or durable job UX.
- **Cloudflare/internal context** — use the `cfi` CLI for internal Cloudflare Wiki/Jira/Backstage/GitLab/dependency context when the topic touches Cloudflare company knowledge, Cloudflare packages, internal gateways, Access, Workers AI, Browser, Think, Agents, Voice, Code Mode, Sandbox, or deployment wrappers. Do not persist credentials or write internally.
- **Local product evidence** — inspect the current My AX repo, production proof history, active bugs, screenshots, and recently changed surfaces.

Return a short research digest with sources, the absorbable idea or bug, and why it matters for the owner loop. If research finds a current external/internal bug relevant to My AX, try to reproduce or adapt the smallest safe version in this run.

### SELECT

- Confirm the checkout is clean and record the starting revision.
- Choose the best bounded candidate from the research digest.
- Inspect one narrow surface and reproduce one concrete problem or missing owner journey.
- Do not duplicate a recently completed finding.
- Freeze the user outcome, scope, acceptance criteria, smallest intervention, and production proof plan before editing.
- Stop with no-change if evidence is insufficient.

### CHANGE

- Use one isolated worktree and exactly one writer.
- Make the smallest coherent fix.
- Add an observable regression test where practical.
- Remove only code/docs made obsolete by this change.
- Preserve the invariants below.

### VERIFY

- Run the narrow proof, then `npm run verify:changed`.
- Review the final diff once for behavior, scope, stale paths, and public/private leakage.
- Report failures and flakes truthfully; never weaken a boundary to pass.

### REPORT

Return:

- research digest with external/internal/local sources;
- finding and user-outcome evidence;
- files changed and patch digest;
- exact commands/outcomes;
- remaining risks;
- recommended parent integration and production proof;
- whether this counts as one of the two shareable product features.

The child must not commit, push, migrate, deploy, access production, rotate credentials, or mutate external services.

## Parent: REVIEW → INTEGRATE → DEPLOY → PROVE → REPEAT

- Validate the exact child receipt and patch; callbacks are wakeups, not authority.
- Independently rerun the narrow proof and `npm run verify:release`.
- Update `CHANGELOG.md` without changing version `0.0.1`.
- Commit and push the accepted change.
- Deploy employee production only through the private wrapper; deploy other installations through their owner wrapper.
- Prove the changed journey against the exact revision/deployment. Prefer an authenticated real journey; use a truthful, self-cleaning operator probe when inducing the negative case would harm a real conversation.
- If proof fails, continue this iteration through bounded repair or rollback. Do not stop merely because operator input was needed once that input is provided.

Before completion record:

```yaml
release_summary:
  title: plain-language change
  benefit: what is better for the user
  action: required action, or "No action required"
  visibility: whats-new | attention | direct | none
```

Demo/video work is optional after production proof and does not block operational completion.

For normal `/loop`, after each proved feature decide whether the run has two meaningful/exciting features to share. If not, repeat the research/select/change/prove cycle with a new bounded candidate. Maintain one writer at a time throughout; research scouts may run read-only in parallel.

## Invariants

- Think's `MyAgent` is canonical for text and voice.
- Production requires Cloudflare Access; only explicit dev mode may bypass it.
- Public source contains no deployment identity, private hosts, account IDs, Access details, secrets, or private history.
- `machinectl` remains outbound-only and explicitly user-controlled.
- Generated Code Mode receives callable capabilities, never raw credentials or ambient authority.
- D1 is the human/search/export projection; Think owns execution/model state.
- Restore and ownership checks fail closed. Never print, persist, or commit credentials.
- Preserve the seven-minute repository rules in [`docs/loop/repository-standard.md`](docs/loop/repository-standard.md).

## Terrarium/Pi behavior

- Terrarium background execution is accessed through MCP tools.
- The Pi `terrarium-autocontinue` extension tracks spawned run IDs and resumes the parent on terminal callback delivery.
- Do not sleep or busy-poll after a background spawn. End the turn and handle the terminal callback when Pi surfaces it.
- If host callback delivery is unavailable, query the known run ID; never launch a duplicate merely because a callback was delayed.

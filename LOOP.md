# My AX improvement loop

This file is the durable entry point for an agent asked to improve My AX in a loop. Read it before starting a loop iteration.

## Objective

Continuously make My AX more reliable, secure, simple, and useful through small, evidence-backed changes. Prefer deleting custom glue when a current Cloudflare primitive provides the same capability.

One **iteration** is:

```text
SEARCH → FIX → VERIFY → HANDOFF
```

An iteration is complete only when it leaves either:

1. one focused, verified diff for the parent to integrate; or
2. a no-change receipt explaining what was tested and why no safe improvement was justified.

## Scope

Repository: this checkout of `acoyfellow/my-ax`.

Prioritize one narrow surface per iteration:

- session switching, resume, compaction, and transcript durability;
- Sandbox workspace mutation, snapshot, restore, and ordering;
- recurring jobs and idempotent state transitions;
- MCP discovery, authorization, repair, and bounded Code Mode;
- bridge ownership, replay resistance, and connector boundaries;
- push, decision receipts, and walk-away completion;
- voice convergence on the canonical Think session;
- browser recording ownership and public URL policy;
- deployment, migration, and production-proof reliability;
- removal of obsolete glue in favor of managed Cloudflare primitives.

Do not broaden an iteration after selecting its experiment.

## Invariants

- Think's `MyAgent` remains the canonical session for text and voice.
- Production requires Cloudflare Access; only explicit dev mode may bypass it.
- Public source must contain no employee MCP names, internal hosts, account IDs, Access details, secrets, or private deployment history.
- Employee deployment is owned by the private wrapper and its `deploy-employee.sh`.
- `machinectl` remains outbound-only and explicitly user-controlled.
- Generated Code Mode receives callable capabilities, not raw credentials or ambient network/filesystem authority.
- D1 is the human/search/export projection; Think owns execution/model state.
- Restore and ownership checks fail closed.
- Never print, persist, or commit credentials.

## Authority and concurrency

- Exactly one writer may operate on this checkout at a time.
- A Terrarium iteration uses exactly one child run.
- The child may inspect, edit, and run local tests, but must not commit, tag, push, migrate, deploy, rotate credentials, or mutate production.
- The parent owns review, integration, commits, tags, migrations, deployment, and production verification.
- Do not start if the checkout has unrelated changes or another writer is active.

## Iteration protocol

### 1. SEARCH

1. Record the starting revision and verify the checkout state.
2. Choose one experiment not duplicating the latest completed finding.
3. Read the relevant implementation and tests.
4. Reproduce a concrete defect or identify a specific simplification with direct evidence.
5. Freeze the finding before editing:
   - stable ID;
   - title and severity;
   - expected versus actual behavior;
   - deterministic reproduction or evidence;
   - affected files;
   - proposed smallest fix.

If no finding survives scrutiny, stop with a no-change receipt. Do not invent work to satisfy the loop.

### 2. FIX

1. Make the smallest coherent change that addresses the frozen finding.
2. Add or strengthen a regression test that fails before the fix and passes after it when practical.
3. Avoid opportunistic refactors, dependency upgrades, generated-file churn, and unrelated formatting.
4. Preserve all invariants above.

### 3. VERIFY

Run the narrow regression first, then the relevant broader checks. At minimum, report exact commands and exit status. Typical checks include:

```bash
npm test
npm run typecheck
npm run build
npm run verify:public-clean
```

Use only commands that exist in `package.json`; do not claim checks that were not run. Inspect the final diff for secret or employee-data leakage.

Verification is independent of implementation intent: test the observable invariant, not merely the new branch or helper.

### 4. HANDOFF

Do not commit. Return a concise receipt containing:

```text
start revision
iteration result: changed | no-change | blocked
frozen finding (or search experiment for no-change)
files changed
verification commands and outcomes
remaining risks
recommended parent integration/proof
```

A locally verified fix is not production-certified. Mark production proof as pending unless the parent performs it.

## Failure policy

- Stop after one focused iteration.
- If a test exposes a second independent defect, record it as follow-up rather than expanding scope.
- If required credentials, external services, or production access are missing, leave the code locally verified when possible and report the blocker truthfully.
- Never weaken a security boundary or a test merely to make verification pass.
- Never overwrite unrelated work.

## Terrarium invocation

A parent can run one iteration with a single writer child using a task equivalent to:

```text
Read LOOP.md completely and execute exactly one SEARCH → FIX → VERIFY → HANDOFF iteration. You are the only writer. You may edit files and run local tests. Do not commit, tag, push, migrate, deploy, access production, or expose secrets. Stop after one focused finding and return the required receipt.
```

The parent must verify the child’s claims and inspect the diff before integration.

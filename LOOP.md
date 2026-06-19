# My AX improvement loop

This file is the durable entry point for an agent asked to improve My AX in a loop. Read it before starting a loop iteration.

## Objective

Continuously make My AX more reliable, secure, simple, and useful through small, evidence-backed changes. Prefer deleting custom glue when a current Cloudflare primitive provides the same capability.

One **iteration** is:

```text
SEARCH → FIX → VERIFY → INTEGRATE → DEPLOY → PROVE → HANDOFF
```

An iteration is complete only when it leaves either:

1. one focused change that the parent has independently verified, integrated, deployed, and proven in production; or
2. a no-change receipt explaining what was tested and why no safe improvement was justified.

A merged or locally verified change with production proof still pending is **not complete**. It is `blocked` until the proof passes or the parent explicitly rolls the change back.

## Tracks

Every iteration declares one track:

- `balanced`: compare at least one correctness opportunity, one product/UX opportunity, and one simplification opportunity, then choose the strongest evidence-backed result;
- `hardening`: correctness, reliability, privacy, or security defects;
- `product`: evidence-backed capabilities grounded in current internal work, Cloudflare changelogs/docs, relevant GitHub projects/issues/releases, and direct My AX dogfooding;
- `ui`: browser-first interaction polish, perceived latency, optimistic state, accessibility, responsive layout, loading/error states, and visual hierarchy;
- `simplification`: remove custom glue when a current managed primitive provides the same capability.

Do not default to hardening merely because its acceptance criteria are easiest to automate. Product discovery may use parallel read-only investigations, but exactly one child may write after the opportunity is selected.

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
   - stable ID, type, title, and severity/impact;
   - evidence source and user impact;
   - current versus desired experience;
   - deterministic reproduction or research evidence;
   - affected files;
   - proposed smallest intervention;
   - observable acceptance criteria;
   - production proof plan.

For `product`, answer: Who is doing this? What user problem does it solve? Why does it belong in My AX? What is the smallest useful implementation? How will production use prove value?

For `ui`, reproduce the real deployed journey before editing when practical. Record the visible discontinuity, then require a browser-based production replay after deployment. Component tests or screenshots alone do not complete a UI iteration.

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

### 4. INTEGRATE, DEPLOY, AND PROVE (parent only)

After accepting the child diff, the parent must:

1. independently rerun the narrow regression and relevant broader checks;
2. update `CHANGELOG.md` without changing project version `0.0.1`;
3. commit and push the reviewed change;
4. deploy employee production only through `my-ax-private/deploy-employee.sh`;
5. run a production proof that exercises the changed invariant, plus the wrapper's authenticated post-deploy checks;
6. record the commit, deployment/version ID, exact proof, and result in workflow state.

Prefer a dedicated authenticated API or browser proof. If the exact negative case cannot safely be induced in production, prove the deployed revision and its closest observable boundary, while retaining the deterministic regression as evidence. A generic health check alone is insufficient when a specific production proof is available.

If deployment or proof fails, mark the iteration `blocked`, keep the loop active for bounded repair, and do not advance to the next iteration. Never report the iteration complete with production proof pending.

### 5. HANDOFF

The Terrarium child must not commit or deploy. It returns a concise receipt containing:

```text
start revision
iteration result: changed | no-change | blocked
frozen finding (or search experiment for no-change)
files changed
verification commands and outcomes
remaining risks
recommended parent integration/proof
```

A locally verified fix is not production-certified. The parent must finish deployment and proof before closing the iteration.

## Failure policy

- Stop after one focused iteration.
- If a test exposes a second independent defect, record it as follow-up rather than expanding scope.
- If required credentials, external services, or production access are missing, leave the code locally verified when possible and report the blocker truthfully.
- Never weaken a security boundary or a test merely to make verification pass.
- Never overwrite unrelated work.

## Terrarium invocation

A parent can run one iteration with a single writer child using a task equivalent to:

```text
Read LOOP.md completely and execute exactly one child-owned SEARCH → FIX → VERIFY → HANDOFF pass. You are the only writer. You may edit files and run local tests. Do not commit, tag, push, migrate, deploy, access production, or expose secrets. Stop after one focused finding and return the required receipt so the parent can INTEGRATE → DEPLOY → PROVE.
```

The parent must verify the child’s claims, inspect the diff, integrate it, deploy through the private wrapper, and complete production proof before the iteration ends.

Example controller requests:

```text
Run one My AX LOOP.md iteration with track=ui and browser evidence.
Run one My AX LOOP.md iteration with track=product grounded in internal and GitHub research.
Run one balanced iteration and compare hardening, product/UX, and simplification before choosing.
```

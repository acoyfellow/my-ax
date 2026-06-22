# My AX improvement loop

This file is the durable entry point for an agent asked to improve My AX in a loop. Read it before starting a loop iteration.

## Objective

Continuously make My AX more reliable, secure, simple, and useful through small, evidence-backed changes. Prefer deleting custom glue when a current Cloudflare primitive provides the same capability.

One **iteration** is:

```text
SEARCH → FIX → CLEANUP → VERIFY → INTEGRATE → DEPLOY → PROVE → DEMO → HANDOFF
```

An iteration is complete only when it leaves either:

1. one focused change that the parent has independently verified, integrated, deployed, and proven in production, with its demo/marketing decision recorded; or
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

## Repository usability standard

My AX is a **seven-minute repository**: a below-average engineer should be able to understand what the product does, who owns each state boundary, how a request flows, where a change belongs, and how to verify it within roughly seven minutes.

Every iteration must preserve or improve that property:

- keep canonical entry points and ownership visible; do not hide important behavior behind generic factories or indirection;
- prefer one obvious implementation over parallel legacy/current paths;
- use names that describe present behavior, not migration history or internal project phases;
- keep comments focused on non-obvious invariants and reasons; delete narration, stale provenance, and comments contradicted by current behavior;
- remove dead code, unused dependencies, obsolete adapters, duplicate helpers, stale feature flags, and generated churn exposed by the change;
- keep files cohesive and split them only when the new boundary is easier to explain than the old one;
- update the repository map, architecture, feature matrix, deployment guidance, or operator docs when their claims or entry points changed;
- reject a new abstraction if it expands the contributor map without replacing equivalent complexity;
- never preserve misleading code or docs merely to minimize the diff.

Cleanup must remain bounded to code made dead, misleading, or redundant by the selected finding. Broader cleanup discovered along the way belongs in a follow-up or a dedicated `simplification` iteration.

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

### 2. FIX AND REFINE

1. Make the smallest coherent change that addresses the frozen finding.
2. Add or strengthen a regression test that fails before the fix and passes after it when practical.
3. Refactor the touched architecture until it is clear, cohesive, and maintainable—not merely until the first test passes. Keep this refinement inside the frozen finding and do not turn it into an unrelated rewrite.
4. After each significant step, run the narrow live or local proof available for that layer, inspect the diff with an independent autoreview, and record the result. The Terrarium child still does not commit; the parent creates reviewable commits only after independently accepting each coherent step.
5. Avoid unrelated dependency upgrades, generated-file churn, and formatting changes.
6. Preserve all invariants above.
7. Track progress in the iteration receipt: completed steps, evidence, review findings, remaining risks, and the next production-proof action.

“Happy with the architecture” means the changed boundary has explicit ownership, minimal duplication, understandable state flow, and tests at the observable seam. It does not authorize scope creep or aesthetic rewrites.

### 3. CLEANUP AND REPOSITORY SHAPE

Before verification, inspect the touched neighborhood and final diff:

1. remove code, exports, dependencies, comments, tests, and configuration made obsolete by the change;
2. search for stale names and docs that describe the replaced behavior;
3. confirm there is one obvious owner and request path for the changed capability;
4. check whether new files, helpers, or abstractions reduce total complexity rather than relocate it;
5. ensure contributor-facing paths and commands still exist and match `package.json`;
6. run a focused unused-code/dependency search when practical, but verify every result against custom build manifests, dynamic imports, generated modules, and operator scripts before deleting it;
7. state in the receipt how repository comprehension changed: improved, neutral, or degraded. A degraded result requires further refinement or explicit parent rejection.

Do not turn this step into an unrelated repository-wide rewrite.

### 4. VERIFY

Run the narrow regression first, then the relevant broader checks. At minimum, report exact commands and exit status. Typical checks include:

```bash
npm test
npm run typecheck
npm run build
npm run verify:public-clean
```

Use only commands that exist in `package.json`; do not claim checks that were not run. Inspect the final diff for secret or employee-data leakage.

Verification is independent of implementation intent: test the observable invariant, not merely the new branch or helper.

### 5. INTEGRATE, DEPLOY, AND PROVE (parent only)

After accepting the child diff, the parent must:

1. independently rerun the narrow regression and relevant broader checks;
2. perform a final autoreview of architecture, behavior, security, scope, tests, and public/private leakage; resolve material findings before integration;
3. update `CHANGELOG.md` without changing project version `0.0.1`;
4. commit and push each accepted coherent step with its verification evidence recorded in workflow state;
5. deploy employee production only through `my-ax-private/deploy-employee.sh`;
6. live-test the changed journey or invariant in production, plus the wrapper's authenticated post-deploy checks;
7. record progress, commit(s), deployment/version ID, autoreview outcome, exact proof, and result in workflow state.

### Demo and marketing gate

After production proof, classify the shipped change:

- `marketing-worthy`: a user-visible capability or improvement that can be understood in a short visual flow and is materially useful beyond an internal defect fix;
- `proof-only`: important but primarily operational, invisible, too sensitive, or too small to market honestly.

Record the classification and one-sentence rationale in the iteration receipt. Do not manufacture a marketing story for every fix.

For `marketing-worthy` changes, the parent must:

1. record a real browser flow to a local `.webm` using the `unsurf-record-video` skill and `openLocalBrowser()` from `unsurf/skills/record`;
2. capture the deployed product, not a mock, and exclude login codes, credentials, internal-only names, personal data, unrelated conversations, and browser chrome where practical;
3. keep the flow short, deliberate, and self-explanatory, with waits between actions and a guaranteed `stopRecording()` in `finally`;
4. verify the resulting video is playable and nontrivial; convert to MP4 only when a concrete publishing surface requires it;
5. add the durable video under `docs/media/` with a descriptive stable filename;
6. add a concise link under the relevant `CHANGELOG.md` entry without changing version `0.0.1`; and
7. rerun public-clean verification before committing the media and changelog update.

The video is marketing evidence, not production proof. A successful recording cannot replace tests or authenticated replay, and a failed recording leaves the iteration blocked only when it was classified `marketing-worthy`.

Prefer a dedicated authenticated API or browser proof. If the exact negative case cannot safely be induced in production, prove the deployed revision and its closest observable boundary, while retaining the deterministic regression as evidence. A generic health check alone is insufficient when a specific production proof is available.

If deployment or proof fails, mark the iteration `blocked`, keep the loop active for bounded repair, and do not advance to the next iteration. Never report the iteration complete with production proof pending.

### 6. HANDOFF

The Terrarium child must not commit or deploy. It returns a concise receipt containing:

```text
start revision
iteration result: changed | no-change | blocked
frozen finding (or search experiment for no-change)
files changed
verification commands and outcomes
marketing classification and rationale
recommended demo flow when marketing-worthy
cleanup performed and repository-comprehension outcome
proposed LOOP.md improvement, or `none`
remaining risks
recommended parent integration/proof
```

A locally verified fix is not production-certified. The parent must finish deployment and proof before closing the iteration.

## Evolving this loop

`LOOP.md` is a maintained product-development interface, not immutable ceremony. An iteration may reveal missing safeguards, wasteful steps, unclear receipts, or a better verification/proof method.

- A child may identify and propose a `LOOP.md` change in its handoff, but must not edit `LOOP.md` while governed by that same iteration unless the parent explicitly scoped the run as a process-document iteration.
- The parent decides whether the proposal is general, durable, and compatible with the invariants; task-specific prompt tuning does not belong here.
- Accepted process changes are independently reviewed, verified against the current repository and available tools, and committed separately from the product change that motivated them.
- Process edits must simplify or strengthen future iterations. Do not add a gate without naming the failure it prevents and the evidence that the gate can produce.
- Remove or revise loop instructions when repository architecture, tooling, or managed Cloudflare primitives make them stale.
- Record meaningful process changes in `CHANGELOG.md` only when they alter contributor or release behavior; do not change version `0.0.1`.

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

The parent must verify the child’s claims, inspect the diff, integrate it, deploy through the private wrapper, complete production proof, apply the demo/marketing gate, and only then end the iteration.

Example controller requests:

```text
Run one My AX LOOP.md iteration with track=ui and browser evidence.
Run one My AX LOOP.md iteration with track=product grounded in internal and GitHub research.
Run one balanced iteration and compare hardening, product/UX, and simplification before choosing.
```

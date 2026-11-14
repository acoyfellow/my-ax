# Alchemy Domain for my.ax: plan

Status: steps 1 and 2 done (Jordan said to dogfood Domain). Step 3 (shadow in prod) is next, and needs Jordan's go because it touches the prod worker.

## What Jordan asked for

1. Model my.ax sessions and jobs as Domain commands and events.
2. Use Alchemy for the Cloudflare deploy.

## What exists today

- Sessions and jobs are state machines in `src/fsm/` (`session-status.ts`, `job-status.ts`, `run-status.ts`). They have pure `next*Status` functions, TLA+ specs in `verify/tla/`, and replay tests. The fsm audit blocks raw status UPDATEs outside `src/fsm`.
- State lives in D1 (`sessions`, `jobs`, `runs`). Job alarms live on the `UserAgent` Durable Object.
- The prod deploy is `my-ax-private/deploy-employee.sh`. It clones the public repo, injects ids and secrets into `wrangler.jsonc`, applies D1 migrations, and runs `wrangler deploy` for 11 Durable Object classes, 2 containers and 1 workflow.
- `effect` is at 4.1.2. `@alchemy.run/domain` and `@alchemy.run/cloudflare` are at `2.0.0-beta.87` and need `effect ^4.1.4`.

## Mapping

| my.ax today | Domain concept |
|---|---|
| `SessionStatus` + `nextSessionStatus` | `Session` aggregate. The legal-transition table is its invariant. |
| session events (`turn_started`, `turn_completed`, `archived`, …) | `Domain.Event`s |
| `applySessionEvent` callers | `Domain.Command`s: `StartTurn`, `FinishTurn`, `InterruptTurn`, `ArchiveSession`, `RenameSession` |
| `Job` + `nextJobStatus` | `Job` aggregate: `PauseJob`, `ResumeJob`, `ClaimRun`, `EditJob` |
| `UserAgent` job alarm | a deadline: a policy schedules `RunJobNow`, then the aggregate decides |
| a job run that spawns a turn | a saga: `ClaimRun`, then `StartTurn` in the target session, then `FinishRun` |
| sidebar list, job cards | views (`SessionList`, `JobBoard`) |
| MCP `my_ax_call` | `DomainAi` MCP server from the same Api |

## Order of work (each step ships on its own and can be rolled back)

1. **Done: spike, in memory only.** `src/domain/Job/` holds the aggregate, 5 commands and 5 rejections. `Job.story.test.ts` has 9 stories, including one that checks the aggregate against `nextJobStatus` for every status, command and last-run case. A mutation check broke 4 rules, and each one fails a story. `effect` is now 4.1.4 and `@alchemy.run/domain` is pinned at `2.0.0-beta.87`. The worker does not import it yet.
   Original step: Port the `Job` aggregate to `@alchemy.run/domain` in `src/domain/`. Run it with `Domain.InMemory`. The proof is that the existing `job-status` tests and the TLA `JobSchedule` replay pass against it. No prod change. First, bump `effect` to 4.1.4 and run `npm run check`.
2. **Done: Session aggregate, in memory.** `src/domain/Session/` has `OpenSession` plus one command per fsm event (12). The rules are one `SESSION_RULES` table. `Session.story.test.ts` checks that every fsm event maps to exactly one command with the same from and to, and plays all 60 status × event cases against `nextSessionStatus`. A mutation check broke 3 rules, and each one fails stories.
   Original step: Same proof against `session-status` and the `SessionLifecycle` replay.
3. **Shadow in prod.** The current D1 code stays the source of truth. Each command is also sent to the Domain model, and any difference is logged. Run it for one week.
4. **Cut over jobs.** Job alarms move to a Domain deadline and policy. The `UserAgent` alarm code is deleted. A D1 projection keeps the old tables for reads.
5. **Cut over sessions.** The same for sessions.
6. **Alchemy deploy.** Write `alchemy.run.ts` with the Worker, Durable Objects, D1, KV, R2, containers, workflow and route. First run it in parallel against a preview instance (`deploy-preview.sh`'s target), then replace `deploy-employee.sh`'s `wrangler deploy` step. Secrets and Access stay in the private repo.

## Risks

- **Beta.** `2.0.0-beta.87` may change its API under us. Pin the exact version.
- **Durable Object migrations.** Domain makes its own Durable Object classes, so prod needs new `new_sqlite_classes` migrations. Old classes stay until the cutover is done.
- **Two sources of truth during the shadow.** That is why step 3 only logs and never writes.
- **Deploy blast radius.** An Alchemy deploy that loses the route or the Access vars takes prod offline. Step 6 runs on preview first and keeps the wrapper's 5-check verify.

## The first question for Jordan

Start step 1 (the in-memory `Job` spike, plus the `effect` 4.1.4 bump)?

## Lessons from step 1

- Stories run under `node:test` + tsx as plain Effects. Vitest is not needed.
- Don't spread a command into an event (`{ ...cmd }`). The spread brings the command's `_tag` with it, and the event schema rejects it with a hard-to-read error. List the fields.
- The type checker wants a `node:test` callback to return `Promise<void>`. Wrap `Effect.runPromise`.
- A loop over a union of commands needs a cast at `Story.when`, because steps type-check against one command.
- A table-driven aggregate (one `SESSION_RULES` record plus one `transition` guard) keeps 12 commands short, and lets a test compare the whole table with the fsm table in one assert.

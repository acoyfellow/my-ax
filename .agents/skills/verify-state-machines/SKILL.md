---
name: verify-state-machines
description: "Model-check my-ax's session, recurring-job and laptop-connection state machines with TLA+/TLC, and exhaustively check the browser socket reducer. Use before merging any change to src/fsm/*, src/agent.ts turn handling, src/dead-session-program.ts, src/job-service.ts, src/jobs.ts claim/cancel, src/machinectl-host.ts connect/hello/close, or src/ui/reconnecting-socket.ts."
---

# Verify my-ax state machines

Tests check the orders someone thought of. These checks try every order of the listed events inside small bounds, then report the shortest path to any rule that breaks. Each model points at real code below.

## Run

```sh
PATH=$PWD/node_modules/.bin:$PATH verify/tla/run.sh SessionLifecycle JobSchedule LaptopConnection
node --import tsx --test verify/replays/*.test.ts
```

Needs Java 11+ and `tla2tools.jar` 1.7.4 (sha256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`). Set `TLA2TOOLS` and `JAVA` if they are not at `~/cloudflare/.context/tla/tla2tools.jar` and `/opt/homebrew/opt/openjdk/bin/java`. Each model runs in under two seconds.

`run.sh` first regenerates `verify/tla/SessionTable.tla` from `SESSION_TRANSITIONS` in `src/fsm/session-status.ts`, so the session model always uses the real transition table. Never edit `SessionTable.tla` by hand.

Read every TLC result with the `/statechart` skill. It turns a violation into a short path in plain words and draws the chart. Each model has a `.view.ts` with the reader's labels.

## Expected result at the sync commit

| Check | Result | Meaning |
|---|---|---|
| `LaptopConnection` | PASS, 22 states | An old laptop socket can never wipe or overwrite a newer connection's tools, user or online state. |
| `SessionLifecycle` | PASS, 5 states | The scan now asks the agent for a live turn before flagging (fixed finding 1). |
| `JobSchedule` | PASS, 288 states | The pause rollback now re-reads the job and only reschedules while active (fixed finding 2). |
| `verify/replays/*.test.ts` | all pass | Each finding replayed against the real code, plus the socket reducer checked over every reachable state. |

A new FAIL on any other rule, or a PASS where a finding is listed, means the code or the model changed. Find out which before you merge.

## Known findings

1. **FIXED. A conversation still working could be marked Interrupted, then archived mid-turn.** `runDeadSessionScan` (`src/dead-session-program.ts`) lists sessions whose `updated_at` is older than 5 minutes. `updated_at` only moves when a new user message is logged (`src/agent.ts` `logAcceptedUsers`), not while a tool runs, and the tool watchdog allows 11 minutes (`TURN_TOOL_LIMIT_MS`). It applied `dead_session_detected` without asking the agent whether a turn is live. Fix: the scan now calls `deps.hasLiveTurn` (wired to `Session.hasLiveTurn` in `src/agent.ts`) before reviving, alerting or interrupting, and returns while a turn is live. `ScannerFlagsQuietSession` in the model only fires while idle. Regression: `verify/replays/session-scan-live-turn.replay.test.ts` passes on fixed code and fails on the pre-fix code (verified by stashing the fix).
2. **FIXED. Pausing at the moment the last allowed run was claimed left an out-of-runs job with a live alarm.** `JobService.setPaused` (`src/job-service.ts`) cancels the alarm, then `markJobPaused` matches no row because the claim (`CLAIM_RUN_SQL`) already set `exhausted`. The rollback called `runtime.schedule` and wrote the new `schedule_id` without checking status, so an exhausted job got a fresh alarm that woke forever doing nothing. Fix: the rollback re-reads the job and only reschedules while its status is `active`. `PauseSaves` in the model adds no alarm in its non-active branch. Regression: `verify/replays/job-pause-exhaust.replay.test.ts` passes on fixed code and fails on the pre-fix code (verified by stashing the fix).
3. **`nextSocketConnection` lets the attempt count grow past the limit if a drop arrives after it gave up.** The browser cannot trigger this today, because `reconnecting-socket.ts` only dispatches `dropped` from a live socket's close event, and no socket is live once exhausted. The guard lives in the caller, not the reducer. The replay test pins both facts.

## Coverage

| Model | Covers | Atomic steps match |
|---|---|---|
| `SessionLifecycle.tla` | `src/fsm/session-status.ts` (generated table), `agent.ts` `turn_started`/`turn_completed`/`turn_failed`/`turn_aborted`/`turn_stuck`, `recovery-exhaustion.ts`, `dead-session-program.ts`, `routes/sessions.ts` archive | each `applySessionEvent` is one conditional `UPDATE` |
| `JobSchedule.tla` | `job-service.ts` `setPaused`, `jobs.ts` `CLAIM_RUN_SQL` and cancel on exhaust, `agent.ts` `runRecurringPrompt` | cancel, conditional update, and rollback schedule are separate awaits |
| `LaptopConnection.tla` | `machinectl-host.ts` `acceptLaptopConnection`, `webSocketMessage` hello, `clearActiveSocket`; `fsm/machine-connection.ts` | the Durable Object runs one handler at a time; each handler is one step |
| `verify/replays/socket-exhaustive.test.ts` | `fsm/socket-connection.ts` and the dispatch guard in `ui/reconnecting-socket.ts` | runs the real reducer, no hand model |

Not modeled: run status, recipe status, attention items, desk cards, workspace verification, chat message phase, voice status. Their machines are single-writer tables already covered by `test:fsm`. Also not modeled: the Pi engine status path (`pi_run_*`), D1 replication delay, and more than one owner.

Bounds: `MaxRuns = 2`, `MaxAlarms = 4`, `MaxSockets = 3`, socket `MAX_ATTEMPTS = 3`. A pass covers these bounds only.

## Proved able to fail

- `LaptopConnection`: removing the generation check from hello and close (`mutants/LaptopNoGenCheck.tla`) breaks `CatalogBelongsToCurrentLaptop`.
- `JobSchedule`: dropping the `status = "active"` guard in `PauseSaves` (`mutants/JobPauseNoGuard.tla`) breaks `ExhaustedStaysExhausted`.
- `SessionLifecycle`: removing `running` from `turn_completed.from` in `src/fsm/session-status.ts` breaks `NeverStuckRunning`, because the table is generated from the real code.

## Sync

Last confirmed against commit `83bb5b398219a5d0a5908dabe1e7a785d1e4c80b`. Before you move this forward, read every covered file's diff since that commit and confirm each model still describes it. If a change is intended, update the model and the expected-result table in the same commit. Never weaken a rule to make it pass. If a finding is fixed, flip its row to PASS and keep its replay test as a regression test.

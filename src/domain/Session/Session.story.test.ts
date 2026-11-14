import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { nextSessionStatus, SESSION_TRANSITIONS, type SessionStatus, type SessionStatusEvent } from "../../fsm/session-status";
import { MyAx } from "../MyAx.model";
import { ArchiveSession, SessionArchived } from "./ArchiveSession.command";
import { CompleteTurn, TurnCompleted } from "./CompleteTurn.command";
import { OpenSession, SessionOpened } from "./OpenSession.command";
import { Session, SESSION_RULES, type SessionCommandName, type SessionStage } from "./Session.aggregate";
import { SessionAlreadyOpen, SessionNotFound, TransitionRefused } from "./SessionRejections.rejection";
import { StartTurn, TurnStarted } from "./StartTurn.command";
import { UnarchiveSession, SessionUnarchived } from "./UnarchiveSession.command";
import * as Commands from "./commands";
import { DeleteSession, SessionDeleted } from "./DeleteSession.command";
import { SessionDetailsUpdated, UpdateSessionDetails } from "./UpdateSessionDetails.command";

const story = Story.make(MyAx);
const s1 = Session.ref("s1");
const opened = new SessionOpened({ ownerEmail: "owner@example.com", name: "Main" });
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

test("the model with sessions is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("a session can be deleted once, and is gone after", () =>
  run(
    story(
      Story.given(s1, opened, new SessionArchived()),
      Story.when(s1, new DeleteSession()),
      Story.then(s1, new SessionDeleted()),
      Story.state(s1, { _tag: "Unopened" }),
      Story.when(s1, new DeleteSession()),
      Story.rejected(new SessionNotFound()),
    ),
  ));

test("renaming a session changes its name and keeps its stage", () =>
  run(
    story(
      Story.given(s1, opened, new TurnStarted()),
      Story.when(s1, new UpdateSessionDetails({ detail: "name", name: "Renamed" })),
      Story.then(s1, new SessionDetailsUpdated({ detail: "name", name: "Renamed" })),
      Story.state(s1, { _tag: "Open", name: "Renamed", stage: "Running" }),
      Story.when(s1, new UpdateSessionDetails({ detail: "pin", name: null })),
      Story.then(s1, new SessionDetailsUpdated({ detail: "pin", name: null })),
      Story.state(s1, { _tag: "Open", name: "Renamed", stage: "Running" }),
    ),
  ));

test("details of a missing session cannot be changed", () =>
  run(story(Story.when(s1, new UpdateSessionDetails({ detail: "touch", name: null })), Story.rejected(new SessionNotFound()))));

test("a session opens once", () =>
  run(
    story(
      Story.when(s1, new OpenSession({ ownerEmail: "owner@example.com", name: "Main" })),
      Story.then(s1, opened),
      Story.state(s1, { _tag: "Open", stage: "Active" }),
      Story.when(s1, new OpenSession({ ownerEmail: "owner@example.com", name: "Again" })),
      Story.rejected(new SessionAlreadyOpen()),
    ),
  ));

test("a turn runs and completes", () =>
  run(
    story(
      Story.given(s1, opened),
      Story.when(s1, new StartTurn()),
      Story.then(s1, new TurnStarted()),
      Story.state(s1, { stage: "Running" }),
      Story.when(s1, new CompleteTurn()),
      Story.then(s1, new TurnCompleted()),
      Story.state(s1, { stage: "Active" }),
    ),
  ));

test("an archived chat cannot be archived again, and a new turn wakes it", () =>
  run(
    story(
      Story.given(s1, opened, new SessionArchived()),
      Story.when(s1, new ArchiveSession()),
      Story.rejected(new TransitionRefused({ status: "Archived", command: "ArchiveSession" })),
      Story.when(s1, new StartTurn()),
      Story.then(s1, new TurnStarted()),
      Story.state(s1, { stage: "Running" }),
    ),
  ));

test("unarchive only works on an archived chat", () =>
  run(
    story(
      Story.given(s1, opened),
      Story.when(s1, new UnarchiveSession()),
      Story.rejected(new TransitionRefused({ status: "Active", command: "UnarchiveSession" })),
      Story.when(s1, new ArchiveSession()),
      Story.then(s1, new SessionArchived()),
      Story.when(s1, new UnarchiveSession()),
      Story.then(s1, new SessionUnarchived()),
    ),
  ));

test("a command on a session that was never opened is refused", () =>
  run(story(Story.when(s1, new StartTurn()), Story.rejected(new SessionNotFound()))));

const STAGE_OF: Record<SessionStatus, SessionStage> = { active: "Active", running: "Running", error: "Error", interrupted: "Interrupted", archived: "Archived" };
const COMMAND_FOR: Record<SessionStatusEvent, SessionCommandName> = {
  turn_started: "StartTurn",
  turn_completed: "CompleteTurn",
  turn_failed: "FailTurn",
  turn_aborted: "AbortTurn",
  turn_stuck: "MarkTurnStuck",
  recovery_exhausted: "ExhaustRecovery",
  dead_session_detected: "DetectDeadSession",
  pi_run_started: "StartPiRun",
  pi_run_settled: "SettlePiRun",
  pi_run_settled_failed: "FailPiRun",
  archived: "ArchiveSession",
  unarchived: "UnarchiveSession",
};

type SessionEvent = InstanceType<(typeof Commands)["TurnStarted" | "TurnFailed" | "RecoveryExhausted" | "SessionArchived"]>;

const ENTER: Record<SessionStage, ReadonlyArray<SessionEvent>> = {
  Active: [],
  Running: [new TurnStarted()],
  Error: [new TurnStarted(), new Commands.TurnFailed()],
  Interrupted: [new Commands.RecoveryExhausted()],
  Archived: [new SessionArchived()],
};

test("every fsm event has exactly one Domain command, with the same from and to", () => {
  assert.deepEqual(Object.keys(COMMAND_FOR).sort(), Object.keys(SESSION_TRANSITIONS).sort());
  for (const [event, command] of Object.entries(COMMAND_FOR) as Array<[SessionStatusEvent, SessionCommandName]>) {
    const fsm = SESSION_TRANSITIONS[event];
    const rule = SESSION_RULES[command];
    assert.deepEqual([...rule.from].sort(), fsm.from.map((status) => STAGE_OF[status]).sort(), `${command} from`);
    assert.equal(rule.to, STAGE_OF[fsm.to], `${command} to`);
  }
});

test("the Domain aggregate agrees with nextSessionStatus for all 5 statuses and 12 events", async () => {
  for (const status of Object.keys(STAGE_OF) as SessionStatus[]) {
    for (const event of Object.keys(COMMAND_FOR) as SessionStatusEvent[]) {
      const commandName = COMMAND_FOR[event];
      const command = new Commands.ALL[commandName]() as StartTurn;
      const expected = nextSessionStatus(status, event);
      const history = [opened, ...ENTER[STAGE_OF[status]]];
      const outcome = expected === null
        ? story(Story.given(s1, ...history), Story.when(s1, command), Story.rejected(new TransitionRefused({ status: STAGE_OF[status], command: commandName })))
        : story(Story.given(s1, ...history), Story.when(s1, command), Story.then(s1, SESSION_RULES[commandName].event() as TurnStarted), Story.state(s1, { stage: STAGE_OF[expected] }));
      await run(outcome).catch((cause) => {
        throw new Error(`${status} + ${event} expected ${expected ?? "refused"}: ${String((cause as Error).message ?? cause).slice(0, 300)}`);
      });
    }
  }
});

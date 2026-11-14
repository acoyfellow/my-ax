import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { nextRunStatus, type RunStatus, type RunStatusEvent } from "../../fsm/run-status";
import { MyAx } from "../MyAx.model";
import { Run, RUN_RULES, type RunCommandName, type RunStage } from "./Run.aggregate";
import { StartRun, RunStarted } from "./StartRun.command";
import { RunAlreadyExists, RunNotFound, RunTransitionRefused } from "./RunRejections.rejection";
import { RecordReceipt, ReceiptRecorded } from "./RecordReceipt.command";
import * as Commands from "./commands";

const story = Story.make(MyAx);
const ref = Run.ref("x1");
const OWNER = "owner@example.com";
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

const STAGE_OF: Record<RunStatus, RunStage> = { open: "Open", running: "Running", completed: "Completed", failed: "Failed", aborted: "Aborted" };
const COMMAND_FOR: Record<RunStatusEvent, RunCommandName> = {
  receipt_recorded: "RecordReceipt",
  recipe_succeeded: "SucceedRecipe",
  recipe_failed: "FailRecipe",
  decision_answered: "AnswerDecision",
  decision_reopened: "ReopenDecision",
  decision_superseded: "SupersedeDecision",
  owner_completed: "CompleteRun",
  owner_failed: "FailRun",
  owner_aborted: "AbortRun",
};

test("the model with Run is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("a Run is created once, in the stage asked for", () =>
  run(
    story(
      Story.when(ref, new StartRun({ ownerEmail: OWNER, stage: "Open" })),
      Story.then(ref, new RunStarted({ ownerEmail: OWNER, stage: "Open" })),
      Story.state(ref, { _tag: "Present", stage: "Open" }),
      Story.when(ref, new StartRun({ ownerEmail: OWNER, stage: "Open" })),
      Story.rejected(new RunAlreadyExists()),
    ),
  ));

test("a command on a Run that does not exist is refused", () =>
  run(story(Story.when(ref, new RecordReceipt()), Story.rejected(new RunNotFound()))));

test("every fsm event maps to one command with the same from and to", () => {
  assert.equal(Object.keys(COMMAND_FOR).length, Object.keys(RUN_RULES).length);
  for (const [event, command] of Object.entries(COMMAND_FOR) as Array<[RunStatusEvent, RunCommandName]>) {
    for (const status of Object.keys(STAGE_OF) as RunStatus[]) {
      const fsmNext = nextRunStatus(status, event);
      const rule = RUN_RULES[command];
      const domainNext = (rule.from as readonly string[]).includes(STAGE_OF[status]) ? rule.to : null;
      assert.equal(domainNext, fsmNext === null ? null : STAGE_OF[fsmNext], `${status} + ${event}`);
    }
  }
});

test("the Domain aggregate agrees with nextRunStatus for every status and event", async () => {
  for (const status of Object.keys(STAGE_OF) as RunStatus[]) {
    for (const event of Object.keys(COMMAND_FOR) as RunStatusEvent[]) {
      const name = COMMAND_FOR[event];
      const command = new Commands.ALL[name]() as RecordReceipt;
      const expected = nextRunStatus(status, event);
      const given = Story.given(ref, new RunStarted({ ownerEmail: OWNER, stage: STAGE_OF[status] }));
      const outcome = expected === null
        ? story(given, Story.when(ref, command), Story.rejected(new RunTransitionRefused({ status: STAGE_OF[status], command: name })))
        : story(given, Story.when(ref, command), Story.then(ref, RUN_RULES[name].event() as ReceiptRecorded), Story.state(ref, { stage: STAGE_OF[expected] }));
      await run(outcome).catch((cause) => {
        throw new Error(`${status} + ${event} expected ${expected ?? "refused"}: ${String((cause as Error).message ?? cause).slice(0, 300)}`);
      });
    }
  }
});

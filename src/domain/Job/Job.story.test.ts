import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { nextJobStatus, type JobStatus, type JobStatusEvent } from "../../fsm/job-status";
import { MyAx } from "../MyAx.model";
import { ClaimRun, RunClaimed } from "./ClaimRun.command";
import { CreateJob, JobCreated } from "./CreateJob.command";
import { EditJob, JobEdited } from "./EditJob.command";
import { Job } from "./Job.aggregate";
import { JobExhausted, JobNotActive, JobNotFound, JobNotPaused } from "./JobRejections.rejection";
import { JobPaused, PauseJob } from "./PauseJob.command";
import { JobResumed, ResumeJob } from "./ResumeJob.command";

const story = Story.make(MyAx);
const j1 = Job.ref("j1");
const created = (maxRuns: number | null = null) =>
  new JobCreated({ ownerEmail: "owner@example.com", name: "Morning pick", prompt: "Pick one", cadenceSecs: 86_400, maxRuns });
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

test("the model is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("a new job starts active", () =>
  run(
    story(
      Story.when(j1, new CreateJob({ ownerEmail: "owner@example.com", name: "Morning pick", prompt: "Pick one", cadenceSecs: 86_400, maxRuns: null })),
      Story.then(j1, created()),
      Story.state(j1, { _tag: "Active", runCount: 0 }),
    ),
  ));

test("pause, then resume", () =>
  run(
    story(
      Story.given(j1, created()),
      Story.when(j1, new PauseJob()),
      Story.then(j1, new JobPaused()),
      Story.when(j1, new PauseJob()),
      Story.rejected(new JobNotActive({ status: "Paused" })),
      Story.when(j1, new ResumeJob()),
      Story.then(j1, new JobResumed()),
      Story.when(j1, new ResumeJob()),
      Story.rejected(new JobNotPaused({ status: "Active" })),
    ),
  ));

test("the last allowed run exhausts the job, and it cannot run, pause or resume after", () =>
  run(
    story(
      Story.given(j1, created(2)),
      Story.when(j1, new ClaimRun()),
      Story.then(j1, new RunClaimed({ runCount: 1, exhausted: false })),
      Story.replied({ runCount: 1, exhausted: false }),
      Story.when(j1, new ClaimRun()),
      Story.then(j1, new RunClaimed({ runCount: 2, exhausted: true })),
      Story.replied({ runCount: 2, exhausted: true }),
      Story.when(j1, new ClaimRun()),
      Story.rejected(new JobExhausted({ runCount: 2 })),
      Story.when(j1, new PauseJob()),
      Story.rejected(new JobExhausted({ runCount: 2 })),
      Story.when(j1, new ResumeJob()),
      Story.rejected(new JobExhausted({ runCount: 2 })),
    ),
  ));

test("a paused job does not run", () =>
  run(
    story(
      Story.given(j1, created(), new JobPaused()),
      Story.when(j1, new ClaimRun()),
      Story.rejected(new JobNotActive({ status: "Paused" })),
    ),
  ));

test("an edit cannot bring an exhausted job back to life", () =>
  run(
    story(
      Story.given(j1, created(1), new RunClaimed({ runCount: 1, exhausted: true })),
      Story.when(j1, new EditJob({ name: "n", prompt: "p", cadenceSecs: 60, maxRuns: 5 })),
      Story.rejected(new JobExhausted({ runCount: 1 })),
      Story.when(j1, new EditJob({ name: "n", prompt: "p", cadenceSecs: 60, maxRuns: 1 })),
      Story.then(j1, new JobEdited({ name: "n", prompt: "p", cadenceSecs: 60, maxRuns: 1, exhausted: true })),
    ),
  ));

test("lowering max runs below the run count exhausts the job", () =>
  run(
    story(
      Story.given(j1, created(), new RunClaimed({ runCount: 3, exhausted: false })),
      Story.when(j1, new EditJob({ name: "n", prompt: "p", cadenceSecs: 60, maxRuns: 2 })),
      Story.then(j1, new JobEdited({ name: "n", prompt: "p", cadenceSecs: 60, maxRuns: 2, exhausted: true })),
      Story.state(j1, { _tag: "Exhausted" }),
    ),
  ));

test("a command on a job that does not exist is refused", () =>
  run(
    story(
      Story.when(j1, new ClaimRun()),
      Story.rejected(new JobNotFound()),
    ),
  ));

const FSM_EVENT: Record<string, JobStatusEvent> = { PauseJob: "paused", ResumeJob: "resumed", ClaimRun: "run_claimed" };
const TAG_OF: Record<JobStatus, "Active" | "Paused" | "Exhausted"> = { active: "Active", paused: "Paused", exhausted: "Exhausted" };

test("the Domain aggregate agrees with the src/fsm job table for every status and command", async () => {
  for (const status of ["active", "paused", "exhausted"] as const) {
    for (const command of ["PauseJob", "ResumeJob", "ClaimRun"] as const) {
      for (const lastRun of [false, true]) {
        const maxRuns = lastRun ? 1 : null;
        const expected = nextJobStatus(status, FSM_EVENT[command]!, { exhaustedAfter: lastRun });
        const history = status === "active" ? [created(maxRuns)]
          : status === "paused" ? [created(maxRuns), new JobPaused()]
          : [created(1), new RunClaimed({ runCount: 1, exhausted: true })];
        const cmd = command === "PauseJob" ? new PauseJob() : command === "ResumeJob" ? new ResumeJob() : new ClaimRun();
        const runCount = status === "exhausted" ? 1 : 0;
        const outcome = expected === null
          ? story(Story.given(j1, ...history), Story.when(j1, cmd as ClaimRun), Story.rejected(rejectionFor(status, command, runCount) as JobNotActive))
          : story(Story.given(j1, ...history), Story.when(j1, cmd as ClaimRun), Story.then(j1, eventFor(command, runCount + 1, expected === "exhausted")), Story.state(j1, { _tag: TAG_OF[expected] }));
        await run(outcome).catch((cause) => {
          throw new Error(`${status} + ${command} (lastRun=${lastRun}) expected ${expected ?? "refused"}: ${String((cause as Error).message ?? cause).slice(0, 400)}`);
        });
      }
    }
  }
});

function eventFor(command: string, runCount: number, exhausted: boolean) {
  if (command === "PauseJob") return new JobPaused();
  if (command === "ResumeJob") return new JobResumed();
  return new RunClaimed({ runCount, exhausted });
}

function rejectionFor(status: JobStatus, command: string, runCount: number) {
  if (status === "exhausted") return new JobExhausted({ runCount });
  if (command === "ResumeJob") return new JobNotPaused({ status: TAG_OF[status] });
  return new JobNotActive({ status: TAG_OF[status] });
}

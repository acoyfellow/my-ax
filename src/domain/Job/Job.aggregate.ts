import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ClaimRun, RunClaimed } from "./ClaimRun.command";
import { CreateJob, JobCreated } from "./CreateJob.command";
import { EditJob, JobEdited } from "./EditJob.command";
import { JobId } from "./Job.id";
import { JobAlreadyExists, JobExhausted, JobNotActive, JobNotFound, JobNotPaused } from "./JobRejections.rejection";
import { JobPaused, PauseJob } from "./PauseJob.command";
import { JobResumed, ResumeJob } from "./ResumeJob.command";

const JobFields = {
  ownerEmail: Schema.String,
  name: Schema.String,
  prompt: Schema.String,
  cadenceSecs: Schema.Int,
  maxRuns: Schema.NullOr(Schema.Int),
  runCount: Schema.Int,
};

export const JobState = Schema.Union([
  Schema.TaggedStruct("Unscheduled", {}),
  Schema.TaggedStruct("Active", JobFields),
  Schema.TaggedStruct("Paused", JobFields),
  Schema.TaggedStruct("Exhausted", JobFields),
]);
export type JobState = typeof JobState.Type;
type Existing = Exclude<JobState, { _tag: "Unscheduled" }>;

export function exhaustedAt(maxRuns: number | null, runCount: number): boolean {
  return maxRuns !== null && runCount >= maxRuns;
}

const existing = (job: JobState): Existing | JobNotFound => (job._tag === "Unscheduled" ? new JobNotFound() : job);
const live = (job: JobState): Exclude<Existing, { _tag: "Exhausted" }> | JobNotFound | JobExhausted => {
  const found = existing(job);
  if (found._tag === "JobNotFound") return found;
  return found._tag === "Exhausted" ? new JobExhausted({ runCount: found.runCount }) : found;
};

export class Job extends Domain.Aggregate("Job", {
  id: JobId,
  state: JobState,
  initial: { _tag: "Unscheduled" },
  commands: [CreateJob, PauseJob, ResumeJob, ClaimRun, EditJob],
  decide: {
    CreateJob: (job, cmd) => (job._tag !== "Unscheduled" ? new JobAlreadyExists() : [new JobCreated({ ownerEmail: cmd.ownerEmail, name: cmd.name, prompt: cmd.prompt, cadenceSecs: cmd.cadenceSecs, maxRuns: cmd.maxRuns })]),
    PauseJob: (job) => {
      const found = live(job);
      if (found._tag === "JobNotFound" || found._tag === "JobExhausted") return found;
      return found._tag === "Active" ? [new JobPaused()] : new JobNotActive({ status: found._tag });
    },
    ResumeJob: (job) => {
      const found = live(job);
      if (found._tag === "JobNotFound" || found._tag === "JobExhausted") return found;
      return found._tag === "Paused" ? [new JobResumed()] : new JobNotPaused({ status: found._tag });
    },
    ClaimRun: (job) => {
      const found = live(job);
      if (found._tag === "JobNotFound" || found._tag === "JobExhausted") return found;
      if (found._tag !== "Active") return new JobNotActive({ status: found._tag });
      const runCount = found.runCount + 1;
      return [new RunClaimed({ runCount, exhausted: exhaustedAt(found.maxRuns, runCount) })];
    },
    EditJob: (job, cmd) => {
      const found = existing(job);
      if (found._tag === "JobNotFound") return found;
      const exhausted = exhaustedAt(cmd.maxRuns, found.runCount);
      if (found._tag === "Exhausted" && !exhausted) return new JobExhausted({ runCount: found.runCount });
      return [new JobEdited({ name: cmd.name, prompt: cmd.prompt, cadenceSecs: cmd.cadenceSecs, maxRuns: cmd.maxRuns, exhausted })];
    },
  },
  evolve: {
    JobCreated: (_, e) => ({ _tag: "Active" as const, ownerEmail: e.ownerEmail, name: e.name, prompt: e.prompt, cadenceSecs: e.cadenceSecs, maxRuns: e.maxRuns, runCount: 0 }),
    JobPaused: (s) => (s._tag === "Active" ? { ...s, _tag: "Paused" as const } : s),
    JobResumed: (s) => (s._tag === "Paused" ? { ...s, _tag: "Active" as const } : s),
    RunClaimed: (s, e) => (s._tag === "Active" ? { ...s, _tag: e.exhausted ? ("Exhausted" as const) : ("Active" as const), runCount: e.runCount } : s),
    JobEdited: (s, e) => (s._tag === "Unscheduled" ? s : { ...s, _tag: e.exhausted ? ("Exhausted" as const) : s._tag, name: e.name, prompt: e.prompt, cadenceSecs: e.cadenceSecs, maxRuns: e.maxRuns }),
  },
  reply: { ClaimRun: (s) => ({ runCount: s._tag === "Unscheduled" ? 0 : s.runCount, exhausted: s._tag === "Exhausted" }) },
}) {}

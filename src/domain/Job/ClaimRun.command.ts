import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { JobId } from "./Job.id";
import { JobExhausted, JobNotActive, JobNotFound } from "./JobRejections.rejection";

export class RunClaimed extends Domain.Event("RunClaimed", { runCount: Schema.Int, exhausted: Schema.Boolean }) {}

export class ClaimRun extends Domain.Command("ClaimRun", {
  target: JobId,
  events: [RunClaimed],
  rejects: [JobNotFound, JobExhausted, JobNotActive],
  reply: { runCount: Schema.Int, exhausted: Schema.Boolean },
}) {}

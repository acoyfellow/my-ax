import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { JobId } from "./Job.id";
import { JobExhausted, JobNotFound } from "./JobRejections.rejection";

export class JobEdited extends Domain.Event("JobEdited", {
  name: Schema.String,
  prompt: Schema.String,
  cadenceSecs: Schema.Int,
  maxRuns: Schema.NullOr(Schema.Int),
  exhausted: Schema.Boolean,
}) {}

export class EditJob extends Domain.Command("EditJob", {
  target: JobId,
  input: { name: Schema.String, prompt: Schema.String, cadenceSecs: Schema.Int, maxRuns: Schema.NullOr(Schema.Int) },
  events: [JobEdited],
  rejects: [JobNotFound, JobExhausted],
}) {}

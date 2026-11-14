import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { JobId } from "./Job.id";
import { JobAlreadyExists } from "./JobRejections.rejection";

export class JobCreated extends Domain.Event("JobCreated", {
  ownerEmail: Schema.String,
  name: Schema.String,
  prompt: Schema.String,
  cadenceSecs: Schema.Int,
  maxRuns: Schema.NullOr(Schema.Int),
}) {}

export class CreateJob extends Domain.Command("CreateJob", {
  target: JobId,
  input: { ownerEmail: Schema.String, name: Schema.String, prompt: Schema.String, cadenceSecs: Schema.Int, maxRuns: Schema.NullOr(Schema.Int) },
  events: [JobCreated],
  rejects: [JobAlreadyExists],
}) {}

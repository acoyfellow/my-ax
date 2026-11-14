import * as Domain from "@alchemy.run/domain";
import { JobId } from "./Job.id";
import { JobExhausted, JobNotActive, JobNotFound } from "./JobRejections.rejection";

export class JobPaused extends Domain.Event("JobPaused", {}) {}

export class PauseJob extends Domain.Command("PauseJob", {
  target: JobId,
  events: [JobPaused],
  rejects: [JobNotFound, JobExhausted, JobNotActive],
}) {}

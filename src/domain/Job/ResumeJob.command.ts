import * as Domain from "@alchemy.run/domain";
import { JobId } from "./Job.id";
import { JobExhausted, JobNotFound, JobNotPaused } from "./JobRejections.rejection";

export class JobResumed extends Domain.Event("JobResumed", {}) {}

export class ResumeJob extends Domain.Command("ResumeJob", {
  target: JobId,
  events: [JobResumed],
  rejects: [JobNotFound, JobExhausted, JobNotPaused],
}) {}

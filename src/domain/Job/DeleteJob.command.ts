import * as Domain from "@alchemy.run/domain";
import { JobId } from "./Job.id";
import { JobNotFound } from "./JobRejections.rejection";

export class JobDeleted extends Domain.Event("JobDeleted", {}) {}

export class DeleteJob extends Domain.Command("DeleteJob", {
  target: JobId,
  events: [JobDeleted],
  rejects: [JobNotFound],
}) {}

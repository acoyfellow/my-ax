import * as Domain from "@alchemy.run/domain";
import { JobId } from "./Job.id";
import { JobNotFound } from "./JobRejections.rejection";

export class JobBookkeepingRecorded extends Domain.Event("JobBookkeepingRecorded", {}) {}

export class RecordJobBookkeeping extends Domain.Command("RecordJobBookkeeping", {
  target: JobId,
  events: [JobBookkeepingRecorded],
  rejects: [JobNotFound],
}) {}

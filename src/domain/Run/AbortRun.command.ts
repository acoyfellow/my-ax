import * as Domain from "@alchemy.run/domain";
import { RunId } from "./Run.id";
import { RunNotFound, RunTransitionRefused } from "./RunRejections.rejection";

export class RunAborted extends Domain.Event("RunAborted", {}) {}

export class AbortRun extends Domain.Command("AbortRun", {
  target: RunId,
  events: [RunAborted],
  rejects: [RunNotFound, RunTransitionRefused],
}) {}

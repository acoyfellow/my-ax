import * as Domain from "@alchemy.run/domain";
import { RunId } from "./Run.id";
import { RunNotFound, RunTransitionRefused } from "./RunRejections.rejection";

export class RunCompleted extends Domain.Event("RunCompleted", {}) {}

export class CompleteRun extends Domain.Command("CompleteRun", {
  target: RunId,
  events: [RunCompleted],
  rejects: [RunNotFound, RunTransitionRefused],
}) {}

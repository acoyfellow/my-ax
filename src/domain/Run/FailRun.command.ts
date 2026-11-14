import * as Domain from "@alchemy.run/domain";
import { RunId } from "./Run.id";
import { RunNotFound, RunTransitionRefused } from "./RunRejections.rejection";

export class RunFailed extends Domain.Event("RunFailed", {}) {}

export class FailRun extends Domain.Command("FailRun", {
  target: RunId,
  events: [RunFailed],
  rejects: [RunNotFound, RunTransitionRefused],
}) {}

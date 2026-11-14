import * as Domain from "@alchemy.run/domain";
import { RunId } from "./Run.id";
import { RunNotFound } from "./RunRejections.rejection";

export class RunDismissed extends Domain.Event("RunDismissed", {}) {}

export class DismissRun extends Domain.Command("DismissRun", {
  target: RunId,
  events: [RunDismissed],
  rejects: [RunNotFound],
}) {}

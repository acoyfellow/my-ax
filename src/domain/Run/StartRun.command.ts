import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RunId } from "./Run.id";
import { RunAlreadyExists } from "./RunRejections.rejection";

export class RunStarted extends Domain.Event("RunStarted", { ownerEmail: Schema.String, stage: Schema.Literals(["Open", "Running", "Completed", "Failed", "Aborted"]) }) {}

export class StartRun extends Domain.Command("StartRun", {
  target: RunId,
  input: { ownerEmail: Schema.String, stage: Schema.Literals(["Open", "Running", "Completed", "Failed", "Aborted"]) },
  events: [RunStarted],
  rejects: [RunAlreadyExists],
}) {}

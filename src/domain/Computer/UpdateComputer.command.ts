import * as Domain from "@alchemy.run/domain";
import { ComputerChanges } from "./Computer.fields";
import { ComputerId } from "./Computer.id";
import { ComputerNotFound } from "./ComputerRejections.rejection";

export class ComputerUpdated extends Domain.Event("ComputerUpdated", ComputerChanges) {}

export class UpdateComputer extends Domain.Command("UpdateComputer", {
  target: ComputerId,
  input: ComputerChanges,
  events: [ComputerUpdated],
  rejects: [ComputerNotFound],
}) {}

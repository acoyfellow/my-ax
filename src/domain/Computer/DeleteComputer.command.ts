import * as Domain from "@alchemy.run/domain";
import { ComputerId } from "./Computer.id";
import { ComputerNotFound } from "./ComputerRejections.rejection";

export class ComputerDeleted extends Domain.Event("ComputerDeleted", {}) {}

export class DeleteComputer extends Domain.Command("DeleteComputer", {
  target: ComputerId,
  events: [ComputerDeleted],
  rejects: [ComputerNotFound],
}) {}

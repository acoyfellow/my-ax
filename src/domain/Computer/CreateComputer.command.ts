import * as Domain from "@alchemy.run/domain";
import { ComputerFields } from "./Computer.fields";
import { ComputerId } from "./Computer.id";
import { ComputerAlreadyExists } from "./ComputerRejections.rejection";

export class ComputerCreated extends Domain.Event("ComputerCreated", ComputerFields) {}

export class CreateComputer extends Domain.Command("CreateComputer", {
  target: ComputerId,
  input: ComputerFields,
  events: [ComputerCreated],
  rejects: [ComputerAlreadyExists],
}) {}

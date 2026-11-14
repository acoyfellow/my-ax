import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { CreateComputer, ComputerCreated } from "./CreateComputer.command";
import { DeleteComputer, ComputerDeleted } from "./DeleteComputer.command";
import { UpdateComputer, ComputerUpdated } from "./UpdateComputer.command";
import { ComputerFields } from "./Computer.fields";
import { ComputerId } from "./Computer.id";
import { ComputerAlreadyExists, ComputerNotFound } from "./ComputerRejections.rejection";

export const ComputerState = Schema.Union([
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("Present", ComputerFields),
  Schema.TaggedStruct("Deleted", {}),
]);
export type ComputerState = typeof ComputerState.Type;

export class Computer extends Domain.Aggregate("Computer", {
  id: ComputerId,
  state: ComputerState,
  initial: { _tag: "Missing" },
  commands: [CreateComputer, UpdateComputer, DeleteComputer],
  decide: {
    CreateComputer: (current, cmd) =>
      current._tag === "Present" ? new ComputerAlreadyExists() : [new ComputerCreated({ ownerEmail: cmd.ownerEmail, title: cmd.title })],
    UpdateComputer: (current, cmd) =>
      current._tag !== "Present" ? new ComputerNotFound() : [new ComputerUpdated({ title: cmd.title })],
    DeleteComputer: (current) => (current._tag !== "Present" ? new ComputerNotFound() : [new ComputerDeleted()]),
  },
  evolve: {
    ComputerCreated: (_, e) => ({ _tag: "Present" as const, ownerEmail: e.ownerEmail, title: e.title }),
    ComputerUpdated: (current, e) => (current._tag === "Present" ? { ...current, title: e.title } : current),
    ComputerDeleted: () => ({ _tag: "Deleted" as const }),
  },
}) {}

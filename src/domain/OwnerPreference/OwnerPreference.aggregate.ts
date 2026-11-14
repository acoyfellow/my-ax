import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { CreateOwnerPreference, OwnerPreferenceCreated } from "./CreateOwnerPreference.command";
import { DeleteOwnerPreference, OwnerPreferenceDeleted } from "./DeleteOwnerPreference.command";
import { UpdateOwnerPreference, OwnerPreferenceUpdated } from "./UpdateOwnerPreference.command";
import { OwnerPreferenceFields } from "./OwnerPreference.fields";
import { OwnerPreferenceId } from "./OwnerPreference.id";
import { OwnerPreferenceAlreadyExists, OwnerPreferenceNotFound } from "./OwnerPreferenceRejections.rejection";

export const OwnerPreferenceState = Schema.Union([
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("Present", OwnerPreferenceFields),
  Schema.TaggedStruct("Deleted", {}),
]);
export type OwnerPreferenceState = typeof OwnerPreferenceState.Type;

export class OwnerPreference extends Domain.Aggregate("OwnerPreference", {
  id: OwnerPreferenceId,
  state: OwnerPreferenceState,
  initial: { _tag: "Missing" },
  commands: [CreateOwnerPreference, UpdateOwnerPreference, DeleteOwnerPreference],
  decide: {
    CreateOwnerPreference: (current, cmd) =>
      current._tag === "Present" ? new OwnerPreferenceAlreadyExists() : [new OwnerPreferenceCreated({ ownerEmail: cmd.ownerEmail, valueJson: cmd.valueJson })],
    UpdateOwnerPreference: (current, cmd) =>
      current._tag !== "Present" ? new OwnerPreferenceNotFound() : [new OwnerPreferenceUpdated({ valueJson: cmd.valueJson })],
    DeleteOwnerPreference: (current) => (current._tag !== "Present" ? new OwnerPreferenceNotFound() : [new OwnerPreferenceDeleted()]),
  },
  evolve: {
    OwnerPreferenceCreated: (_, e) => ({ _tag: "Present" as const, ownerEmail: e.ownerEmail, valueJson: e.valueJson }),
    OwnerPreferenceUpdated: (current, e) => (current._tag === "Present" ? { ...current, valueJson: e.valueJson } : current),
    OwnerPreferenceDeleted: () => ({ _tag: "Deleted" as const }),
  },
}) {}

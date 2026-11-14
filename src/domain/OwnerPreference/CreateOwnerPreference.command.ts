import * as Domain from "@alchemy.run/domain";
import { OwnerPreferenceFields } from "./OwnerPreference.fields";
import { OwnerPreferenceId } from "./OwnerPreference.id";
import { OwnerPreferenceAlreadyExists } from "./OwnerPreferenceRejections.rejection";

export class OwnerPreferenceCreated extends Domain.Event("OwnerPreferenceCreated", OwnerPreferenceFields) {}

export class CreateOwnerPreference extends Domain.Command("CreateOwnerPreference", {
  target: OwnerPreferenceId,
  input: OwnerPreferenceFields,
  events: [OwnerPreferenceCreated],
  rejects: [OwnerPreferenceAlreadyExists],
}) {}

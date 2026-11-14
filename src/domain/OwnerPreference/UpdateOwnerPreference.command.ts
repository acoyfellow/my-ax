import * as Domain from "@alchemy.run/domain";
import { OwnerPreferenceChanges } from "./OwnerPreference.fields";
import { OwnerPreferenceId } from "./OwnerPreference.id";
import { OwnerPreferenceNotFound } from "./OwnerPreferenceRejections.rejection";

export class OwnerPreferenceUpdated extends Domain.Event("OwnerPreferenceUpdated", OwnerPreferenceChanges) {}

export class UpdateOwnerPreference extends Domain.Command("UpdateOwnerPreference", {
  target: OwnerPreferenceId,
  input: OwnerPreferenceChanges,
  events: [OwnerPreferenceUpdated],
  rejects: [OwnerPreferenceNotFound],
}) {}

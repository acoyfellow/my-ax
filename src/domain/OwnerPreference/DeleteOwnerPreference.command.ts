import * as Domain from "@alchemy.run/domain";
import { OwnerPreferenceId } from "./OwnerPreference.id";
import { OwnerPreferenceNotFound } from "./OwnerPreferenceRejections.rejection";

export class OwnerPreferenceDeleted extends Domain.Event("OwnerPreferenceDeleted", {}) {}

export class DeleteOwnerPreference extends Domain.Command("DeleteOwnerPreference", {
  target: OwnerPreferenceId,
  events: [OwnerPreferenceDeleted],
  rejects: [OwnerPreferenceNotFound],
}) {}

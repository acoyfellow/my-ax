import * as Schema from "effect/Schema";

export const OwnerPreferenceFields = {
  ownerEmail: Schema.String,
  valueJson: Schema.String,
};

export const OwnerPreferenceChanges = {
  valueJson: Schema.String,
};

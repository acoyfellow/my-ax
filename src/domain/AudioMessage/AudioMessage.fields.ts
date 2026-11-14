import * as Schema from "effect/Schema";

export const AudioMessageFields = {
  ownerEmail: Schema.String,
  storageKey: Schema.String,
};

export const AudioMessageChanges = {
  storageKey: Schema.String,
};

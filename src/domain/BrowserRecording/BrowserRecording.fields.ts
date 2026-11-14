import * as Schema from "effect/Schema";

export const BrowserRecordingFields = {
  ownerEmail: Schema.String,
  storageKey: Schema.String,
};

export const BrowserRecordingChanges = {
  storageKey: Schema.String,
};

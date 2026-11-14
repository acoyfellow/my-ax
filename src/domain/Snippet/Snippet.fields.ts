import * as Schema from "effect/Schema";

export const SnippetFields = {
  ownerEmail: Schema.String,
  name: Schema.String,
  body: Schema.String,
};

export const SnippetChanges = {
  name: Schema.String,
  body: Schema.String,
};

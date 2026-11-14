import * as Schema from "effect/Schema";

export const EmailFields = {
  ownerEmail: Schema.String,
  subject: Schema.String,
  readAt: Schema.NullOr(Schema.String),
};

export const EmailChanges = {
  subject: Schema.String,
  readAt: Schema.NullOr(Schema.String),
};

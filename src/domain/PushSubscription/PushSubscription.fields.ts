import * as Schema from "effect/Schema";

export const PushSubscriptionFields = {
  ownerEmail: Schema.String,
  endpoint: Schema.String,
};

export const PushSubscriptionChanges = {
  endpoint: Schema.String,
};

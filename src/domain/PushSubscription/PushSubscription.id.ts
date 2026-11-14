import * as Schema from "effect/Schema";

export const PushSubscriptionId = Schema.String.pipe(Schema.brand("PushSubscriptionId"));
export type PushSubscriptionId = typeof PushSubscriptionId.Type;

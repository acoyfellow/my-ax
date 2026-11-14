import * as Schema from "effect/Schema";

export const AttentionId = Schema.String.pipe(Schema.brand("AttentionId"));
export type AttentionId = typeof AttentionId.Type;

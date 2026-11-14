import * as Schema from "effect/Schema";

export const AudioMessageId = Schema.String.pipe(Schema.brand("AudioMessageId"));
export type AudioMessageId = typeof AudioMessageId.Type;

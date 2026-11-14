import * as Schema from "effect/Schema";

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

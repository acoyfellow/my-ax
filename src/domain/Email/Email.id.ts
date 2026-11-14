import * as Schema from "effect/Schema";

export const EmailId = Schema.String.pipe(Schema.brand("EmailId"));
export type EmailId = typeof EmailId.Type;

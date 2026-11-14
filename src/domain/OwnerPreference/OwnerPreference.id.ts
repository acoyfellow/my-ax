import * as Schema from "effect/Schema";

export const OwnerPreferenceId = Schema.String.pipe(Schema.brand("OwnerPreferenceId"));
export type OwnerPreferenceId = typeof OwnerPreferenceId.Type;

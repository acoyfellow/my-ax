import * as Schema from "effect/Schema";

export const ComputerId = Schema.String.pipe(Schema.brand("ComputerId"));
export type ComputerId = typeof ComputerId.Type;

import * as Schema from "effect/Schema";

export const ComputerLeaseId = Schema.String.pipe(Schema.brand("ComputerLeaseId"));
export type ComputerLeaseId = typeof ComputerLeaseId.Type;

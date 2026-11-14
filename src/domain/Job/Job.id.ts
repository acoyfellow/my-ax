import * as Schema from "effect/Schema";

export const JobId = Schema.String.pipe(Schema.brand("JobId"));
export type JobId = typeof JobId.Type;

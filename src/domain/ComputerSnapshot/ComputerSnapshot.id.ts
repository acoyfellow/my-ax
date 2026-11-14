import * as Schema from "effect/Schema";

export const ComputerSnapshotId = Schema.String.pipe(Schema.brand("ComputerSnapshotId"));
export type ComputerSnapshotId = typeof ComputerSnapshotId.Type;

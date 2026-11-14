import * as Schema from "effect/Schema";

export const WorkspaceSnapshotId = Schema.String.pipe(Schema.brand("WorkspaceSnapshotId"));
export type WorkspaceSnapshotId = typeof WorkspaceSnapshotId.Type;

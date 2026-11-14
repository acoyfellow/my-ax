import * as Schema from "effect/Schema";

export const WorkspaceSnapshotFields = {
  ownerEmail: Schema.String,
  backupId: Schema.String,
  snapshotVersion: Schema.Int,
  sizeBytes: Schema.NullOr(Schema.Int),
};

export const WorkspaceSnapshotChanges = {
  backupId: Schema.String,
  snapshotVersion: Schema.Int,
  sizeBytes: Schema.NullOr(Schema.Int),
};

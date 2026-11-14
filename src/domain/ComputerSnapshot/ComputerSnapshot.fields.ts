import * as Schema from "effect/Schema";

export const ComputerSnapshotFields = {
  ownerEmail: Schema.String,
  backupId: Schema.String,
  backupDir: Schema.String,
  snapshotVersion: Schema.Int,
};

export const ComputerSnapshotChanges = {
  backupId: Schema.String,
  backupDir: Schema.String,
  snapshotVersion: Schema.Int,
};

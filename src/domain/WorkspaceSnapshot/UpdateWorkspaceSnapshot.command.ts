import * as Domain from "@alchemy.run/domain";
import { WorkspaceSnapshotChanges } from "./WorkspaceSnapshot.fields";
import { WorkspaceSnapshotId } from "./WorkspaceSnapshot.id";
import { WorkspaceSnapshotNotFound } from "./WorkspaceSnapshotRejections.rejection";

export class WorkspaceSnapshotUpdated extends Domain.Event("WorkspaceSnapshotUpdated", WorkspaceSnapshotChanges) {}

export class UpdateWorkspaceSnapshot extends Domain.Command("UpdateWorkspaceSnapshot", {
  target: WorkspaceSnapshotId,
  input: WorkspaceSnapshotChanges,
  events: [WorkspaceSnapshotUpdated],
  rejects: [WorkspaceSnapshotNotFound],
}) {}

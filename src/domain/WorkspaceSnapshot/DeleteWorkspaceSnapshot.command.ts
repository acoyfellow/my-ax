import * as Domain from "@alchemy.run/domain";
import { WorkspaceSnapshotId } from "./WorkspaceSnapshot.id";
import { WorkspaceSnapshotNotFound } from "./WorkspaceSnapshotRejections.rejection";

export class WorkspaceSnapshotDeleted extends Domain.Event("WorkspaceSnapshotDeleted", {}) {}

export class DeleteWorkspaceSnapshot extends Domain.Command("DeleteWorkspaceSnapshot", {
  target: WorkspaceSnapshotId,
  events: [WorkspaceSnapshotDeleted],
  rejects: [WorkspaceSnapshotNotFound],
}) {}

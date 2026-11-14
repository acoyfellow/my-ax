import * as Domain from "@alchemy.run/domain";
import { WorkspaceSnapshotFields } from "./WorkspaceSnapshot.fields";
import { WorkspaceSnapshotId } from "./WorkspaceSnapshot.id";
import { WorkspaceSnapshotAlreadyExists } from "./WorkspaceSnapshotRejections.rejection";

export class WorkspaceSnapshotCreated extends Domain.Event("WorkspaceSnapshotCreated", WorkspaceSnapshotFields) {}

export class CreateWorkspaceSnapshot extends Domain.Command("CreateWorkspaceSnapshot", {
  target: WorkspaceSnapshotId,
  input: WorkspaceSnapshotFields,
  events: [WorkspaceSnapshotCreated],
  rejects: [WorkspaceSnapshotAlreadyExists],
}) {}

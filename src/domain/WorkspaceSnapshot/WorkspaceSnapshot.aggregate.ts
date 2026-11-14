import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { CreateWorkspaceSnapshot, WorkspaceSnapshotCreated } from "./CreateWorkspaceSnapshot.command";
import { DeleteWorkspaceSnapshot, WorkspaceSnapshotDeleted } from "./DeleteWorkspaceSnapshot.command";
import { UpdateWorkspaceSnapshot, WorkspaceSnapshotUpdated } from "./UpdateWorkspaceSnapshot.command";
import { WorkspaceSnapshotFields } from "./WorkspaceSnapshot.fields";
import { WorkspaceSnapshotId } from "./WorkspaceSnapshot.id";
import { WorkspaceSnapshotAlreadyExists, WorkspaceSnapshotNotFound } from "./WorkspaceSnapshotRejections.rejection";

export const WorkspaceSnapshotState = Schema.Union([
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("Present", WorkspaceSnapshotFields),
  Schema.TaggedStruct("Deleted", {}),
]);
export type WorkspaceSnapshotState = typeof WorkspaceSnapshotState.Type;

export class WorkspaceSnapshot extends Domain.Aggregate("WorkspaceSnapshot", {
  id: WorkspaceSnapshotId,
  state: WorkspaceSnapshotState,
  initial: { _tag: "Missing" },
  commands: [CreateWorkspaceSnapshot, UpdateWorkspaceSnapshot, DeleteWorkspaceSnapshot],
  decide: {
    CreateWorkspaceSnapshot: (current, cmd) =>
      current._tag === "Present" ? new WorkspaceSnapshotAlreadyExists() : [new WorkspaceSnapshotCreated({ ownerEmail: cmd.ownerEmail, backupId: cmd.backupId, snapshotVersion: cmd.snapshotVersion, sizeBytes: cmd.sizeBytes })],
    UpdateWorkspaceSnapshot: (current, cmd) =>
      current._tag !== "Present" ? new WorkspaceSnapshotNotFound() : [new WorkspaceSnapshotUpdated({ backupId: cmd.backupId, snapshotVersion: cmd.snapshotVersion, sizeBytes: cmd.sizeBytes })],
    DeleteWorkspaceSnapshot: (current) => (current._tag !== "Present" ? new WorkspaceSnapshotNotFound() : [new WorkspaceSnapshotDeleted()]),
  },
  evolve: {
    WorkspaceSnapshotCreated: (_, e) => ({ _tag: "Present" as const, ownerEmail: e.ownerEmail, backupId: e.backupId, snapshotVersion: e.snapshotVersion, sizeBytes: e.sizeBytes }),
    WorkspaceSnapshotUpdated: (current, e) => (current._tag === "Present" ? { ...current, backupId: e.backupId, snapshotVersion: e.snapshotVersion, sizeBytes: e.sizeBytes } : current),
    WorkspaceSnapshotDeleted: () => ({ _tag: "Deleted" as const }),
  },
}) {}

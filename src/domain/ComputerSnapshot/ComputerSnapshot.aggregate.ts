import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { CreateComputerSnapshot, ComputerSnapshotCreated } from "./CreateComputerSnapshot.command";
import { DeleteComputerSnapshot, ComputerSnapshotDeleted } from "./DeleteComputerSnapshot.command";
import { UpdateComputerSnapshot, ComputerSnapshotUpdated } from "./UpdateComputerSnapshot.command";
import { ComputerSnapshotFields } from "./ComputerSnapshot.fields";
import { ComputerSnapshotId } from "./ComputerSnapshot.id";
import { ComputerSnapshotAlreadyExists, ComputerSnapshotNotFound } from "./ComputerSnapshotRejections.rejection";

export const ComputerSnapshotState = Schema.Union([
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("Present", ComputerSnapshotFields),
  Schema.TaggedStruct("Deleted", {}),
]);
export type ComputerSnapshotState = typeof ComputerSnapshotState.Type;

export class ComputerSnapshot extends Domain.Aggregate("ComputerSnapshot", {
  id: ComputerSnapshotId,
  state: ComputerSnapshotState,
  initial: { _tag: "Missing" },
  commands: [CreateComputerSnapshot, UpdateComputerSnapshot, DeleteComputerSnapshot],
  decide: {
    CreateComputerSnapshot: (current, cmd) =>
      current._tag === "Present" ? new ComputerSnapshotAlreadyExists() : [new ComputerSnapshotCreated({ ownerEmail: cmd.ownerEmail, backupId: cmd.backupId, backupDir: cmd.backupDir, snapshotVersion: cmd.snapshotVersion })],
    UpdateComputerSnapshot: (current, cmd) =>
      current._tag !== "Present" ? new ComputerSnapshotNotFound() : [new ComputerSnapshotUpdated({ backupId: cmd.backupId, backupDir: cmd.backupDir, snapshotVersion: cmd.snapshotVersion })],
    DeleteComputerSnapshot: (current) => (current._tag !== "Present" ? new ComputerSnapshotNotFound() : [new ComputerSnapshotDeleted()]),
  },
  evolve: {
    ComputerSnapshotCreated: (_, e) => ({ _tag: "Present" as const, ownerEmail: e.ownerEmail, backupId: e.backupId, backupDir: e.backupDir, snapshotVersion: e.snapshotVersion }),
    ComputerSnapshotUpdated: (current, e) => (current._tag === "Present" ? { ...current, backupId: e.backupId, backupDir: e.backupDir, snapshotVersion: e.snapshotVersion } : current),
    ComputerSnapshotDeleted: () => ({ _tag: "Deleted" as const }),
  },
}) {}

import * as Domain from "@alchemy.run/domain";
import { ComputerSnapshotId } from "./ComputerSnapshot.id";
import { ComputerSnapshotNotFound } from "./ComputerSnapshotRejections.rejection";

export class ComputerSnapshotDeleted extends Domain.Event("ComputerSnapshotDeleted", {}) {}

export class DeleteComputerSnapshot extends Domain.Command("DeleteComputerSnapshot", {
  target: ComputerSnapshotId,
  events: [ComputerSnapshotDeleted],
  rejects: [ComputerSnapshotNotFound],
}) {}

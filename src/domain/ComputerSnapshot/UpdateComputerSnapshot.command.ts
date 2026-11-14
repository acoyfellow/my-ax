import * as Domain from "@alchemy.run/domain";
import { ComputerSnapshotChanges } from "./ComputerSnapshot.fields";
import { ComputerSnapshotId } from "./ComputerSnapshot.id";
import { ComputerSnapshotNotFound } from "./ComputerSnapshotRejections.rejection";

export class ComputerSnapshotUpdated extends Domain.Event("ComputerSnapshotUpdated", ComputerSnapshotChanges) {}

export class UpdateComputerSnapshot extends Domain.Command("UpdateComputerSnapshot", {
  target: ComputerSnapshotId,
  input: ComputerSnapshotChanges,
  events: [ComputerSnapshotUpdated],
  rejects: [ComputerSnapshotNotFound],
}) {}

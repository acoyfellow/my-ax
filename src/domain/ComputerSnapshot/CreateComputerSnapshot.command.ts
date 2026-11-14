import * as Domain from "@alchemy.run/domain";
import { ComputerSnapshotFields } from "./ComputerSnapshot.fields";
import { ComputerSnapshotId } from "./ComputerSnapshot.id";
import { ComputerSnapshotAlreadyExists } from "./ComputerSnapshotRejections.rejection";

export class ComputerSnapshotCreated extends Domain.Event("ComputerSnapshotCreated", ComputerSnapshotFields) {}

export class CreateComputerSnapshot extends Domain.Command("CreateComputerSnapshot", {
  target: ComputerSnapshotId,
  input: ComputerSnapshotFields,
  events: [ComputerSnapshotCreated],
  rejects: [ComputerSnapshotAlreadyExists],
}) {}

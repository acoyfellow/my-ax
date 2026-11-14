import * as Domain from "@alchemy.run/domain";

export class ComputerSnapshotNotFound extends Domain.Rejection("ComputerSnapshotNotFound") {}
export class ComputerSnapshotAlreadyExists extends Domain.Rejection("ComputerSnapshotAlreadyExists") {}

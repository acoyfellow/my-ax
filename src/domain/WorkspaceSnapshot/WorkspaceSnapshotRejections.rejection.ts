import * as Domain from "@alchemy.run/domain";

export class WorkspaceSnapshotNotFound extends Domain.Rejection("WorkspaceSnapshotNotFound") {}
export class WorkspaceSnapshotAlreadyExists extends Domain.Rejection("WorkspaceSnapshotAlreadyExists") {}

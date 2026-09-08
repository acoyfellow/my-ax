import { Effect } from "effect";
import { Database, type DatabaseError } from "./effect/database";
import { createWorkspaceSnapshotManifest, type WorkspaceSnapshotManifest, type WorkspaceSnapshotPointer } from "./workspace-snapshot";

export function publishWorkspaceSnapshot(
  ownerEmail: string,
  backup: WorkspaceSnapshotPointer,
): Effect.Effect<WorkspaceSnapshotManifest, DatabaseError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const manifest = createWorkspaceSnapshotManifest(backup);
    yield* database.run(
      `INSERT INTO workspace_snapshots(owner_email, backup_id, backup_dir, snapshot_version, created_at, updated_at)
       VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
       ON CONFLICT(owner_email) DO UPDATE SET backup_id=excluded.backup_id, backup_dir=excluded.backup_dir, snapshot_version=workspace_snapshots.snapshot_version + 1, updated_at=datetime('now')`,
      [ownerEmail, manifest.backupId, manifest.backupDir],
    );
    return manifest;
  });
}

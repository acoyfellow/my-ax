import { Effect } from "effect";
import { Database, type DatabaseError } from "./effect/database";
import { createWorkspaceSnapshotManifest, type WorkspaceSnapshotManifest, type WorkspaceSnapshotPointer } from "./workspace-snapshot";

export function publishWorkspaceSnapshot(
  ownerEmail: string,
  backup: WorkspaceSnapshotPointer,
  sizeBytes: number | null = null,
  name = "auto",
): Effect.Effect<WorkspaceSnapshotManifest, DatabaseError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const manifest = createWorkspaceSnapshotManifest(backup);
    yield* database.run(
      `INSERT INTO workspace_snapshots(owner_email, backup_id, backup_dir, size_bytes, snapshot_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
       ON CONFLICT(owner_email) DO UPDATE SET backup_id=excluded.backup_id, backup_dir=excluded.backup_dir, size_bytes=excluded.size_bytes, snapshot_version=workspace_snapshots.snapshot_version + 1, updated_at=datetime('now')`,
      [ownerEmail, manifest.backupId, manifest.backupDir, sizeBytes],
    );
    yield* database.run(
      `INSERT INTO workspace_snapshot_history(workspace_key, backup_id, backup_dir, size_bytes, name, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [ownerEmail, manifest.backupId, manifest.backupDir, sizeBytes, name],
    );
    return manifest;
  });
}

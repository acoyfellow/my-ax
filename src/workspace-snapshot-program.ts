import { Effect } from "effect";
import { Database, type DatabaseError } from "./effect/database";
import { decideWorkspaceSnapshot, WORKSPACE_SNAPSHOT_UPSERT } from "./domain/records";
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
    const existing = yield* database.first<{ snapshot_version: number }>(
      "SELECT snapshot_version FROM workspace_snapshots WHERE owner_email = ?",
      [ownerEmail],
    );
    decideWorkspaceSnapshot(ownerEmail, existing?.snapshot_version ?? null, manifest.backupId, sizeBytes);
    yield* database.run(WORKSPACE_SNAPSHOT_UPSERT, [ownerEmail, manifest.backupId, manifest.backupDir, sizeBytes]);
    yield* database.run(
      `INSERT INTO workspace_snapshot_history(workspace_key, backup_id, backup_dir, size_bytes, name, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [ownerEmail, manifest.backupId, manifest.backupDir, sizeBytes, name],
    );
    return manifest;
  });
}

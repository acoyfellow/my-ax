/** Minimal backup pointer needed for owner snapshot publication. */
export interface WorkspaceSnapshotPointer {
  id: string;
  dir: string;
}

export async function publishWorkspaceSnapshot(
  db: D1Database,
  ownerEmail: string,
  backup: WorkspaceSnapshotPointer,
): Promise<void> {
  // Publication order is the winner semantics: each completed backup atomically
  // advances the owner's generation in D1. Thus the backup whose publication
  // commits last is canonical, regardless of invocation time, wall-clock
  // precision, random values, or createBackup completion order. Existing rows
  // from migration 0008 start at generation 0 and advance to 1.
  await db.prepare(
    `INSERT INTO workspace_snapshots(owner_email, backup_id, backup_dir, snapshot_version, created_at, updated_at)
     VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
     ON CONFLICT(owner_email) DO UPDATE SET backup_id=excluded.backup_id, backup_dir=excluded.backup_dir, snapshot_version=workspace_snapshots.snapshot_version + 1, updated_at=datetime('now')`,
  ).bind(ownerEmail, backup.id, backup.dir).run();
}

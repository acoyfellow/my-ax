export interface WorkspaceSnapshotPointer {
  id: string;
  dir: string;
}

export interface WorkspaceSnapshotManifest {
  backupId: string;
  backupDir: string;
}

export interface WorkspaceRestoreResult {
  success: boolean;
  id: string;
  dir: string;
}

export interface WorkspaceRestoreReceipt {
  backupId: string;
  backupDir: string;
  restoredBackupId: string;
  restoredBackupDir: string;
  verified: true;
}

export function createWorkspaceSnapshotManifest(backup: WorkspaceSnapshotPointer): WorkspaceSnapshotManifest {
  return { backupId: backup.id, backupDir: backup.dir };
}

export function verifyWorkspaceRestore(
  manifest: WorkspaceSnapshotManifest,
  result: WorkspaceRestoreResult,
): WorkspaceRestoreReceipt {
  if (!result.success || result.id !== manifest.backupId || result.dir !== manifest.backupDir) {
    throw new Error(`Workspace restore receipt mismatch for backup ${manifest.backupId}`);
  }
  return {
    backupId: manifest.backupId,
    backupDir: manifest.backupDir,
    restoredBackupId: result.id,
    restoredBackupDir: result.dir,
    verified: true,
  };
}

export async function publishWorkspaceSnapshot(
  db: D1Database,
  ownerEmail: string,
  backup: WorkspaceSnapshotPointer,
): Promise<WorkspaceSnapshotManifest> {
  const manifest = createWorkspaceSnapshotManifest(backup);
  // Publication order is the winner semantics: each completed backup atomically
  // advances the owner's generation in D1. Thus the backup whose publication
  // commits last is canonical, regardless of invocation time, wall-clock
  // precision, random values, or createBackup completion order. Existing rows
  // from migration 0008 start at generation 0 and advance to 1.
  await db.prepare(
    `INSERT INTO workspace_snapshots(owner_email, backup_id, backup_dir, snapshot_version, created_at, updated_at)
     VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
     ON CONFLICT(owner_email) DO UPDATE SET backup_id=excluded.backup_id, backup_dir=excluded.backup_dir, snapshot_version=workspace_snapshots.snapshot_version + 1, updated_at=datetime('now')`,
  ).bind(ownerEmail, manifest.backupId, manifest.backupDir).run();
  return manifest;
}

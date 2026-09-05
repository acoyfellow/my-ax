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

import type { DirectoryBackup } from "@cloudflare/sandbox";
import { readyMarkerCheckCommand, workspaceInitCommand } from "./workspace-init";
import { recordObserveEvent } from "./observe-events";
import { verifyWorkspaceRestore, type WorkspaceSnapshotManifest } from "./workspace-snapshot";
import { WORKSPACE_HOME } from "./workspace-path";
import { REBUILDABLE_BACKUP_EXCLUDES, homeLooksWiped, shouldRestoreDirectoryBackup, workspaceSnapshotKey, type WorkspaceScope } from "./workspace-policy";

export const READY_MARKER = "/tmp/my-ax-workspace-ready";
const RESTORE_FALLBACK_DEPTH = 3;

export type ExecOutcome = { stdout?: string; stderr?: string; exitCode?: number; success?: boolean };

export type BootSandbox = {
  exec: (command: string, options: { cwd: string; timeout: number; origin?: "internal" }) => Promise<ExecOutcome>;
  restoreBackup: (backup: DirectoryBackup) => Promise<unknown>;
  destroy: () => Promise<void>;
  restoredFromDiskSnapshot: () => Promise<string | null>;
};

export type WorkspaceBinding = { ownerEmail: string; scope: WorkspaceScope };

export type SnapshotRow = { backup_id: string; backup_dir: string; size_bytes: number | null; updated_at: string };

export async function latestSnapshotRow(db: D1Database, binding: WorkspaceBinding): Promise<SnapshotRow | null> {
  return db.prepare(
    "SELECT backup_id, backup_dir, size_bytes, updated_at FROM workspace_snapshots WHERE owner_email = ?",
  ).bind(workspaceSnapshotKey(binding.ownerEmail, binding.scope)).first<SnapshotRow>();
}

export function workspaceSizeCommand(): string {
  const excludes = REBUILDABLE_BACKUP_EXCLUDES.map((pattern) => `--exclude=${JSON.stringify(pattern)}`).join(" ");
  return `du -sb ${excludes} ${WORKSPACE_HOME} 2>/dev/null | cut -f1`;
}

export async function measureHomeBytes(sandbox: Pick<BootSandbox, "exec">): Promise<number | null> {
  const measured = await sandbox.exec(workspaceSizeCommand(), { cwd: "/", timeout: 20_000, origin: "internal" }).catch(() => null);
  const bytes = Number.parseInt(measured?.stdout?.trim() ?? "", 10);
  return Number.isFinite(bytes) ? bytes : null;
}

async function restoreCandidates(db: D1Database, binding: WorkspaceBinding): Promise<WorkspaceSnapshotManifest[]> {
  const latest = await latestSnapshotRow(db, binding);
  const history = await db.prepare(
    "SELECT backup_id, backup_dir FROM workspace_snapshot_history WHERE workspace_key = ? ORDER BY id DESC LIMIT ?",
  ).bind(workspaceSnapshotKey(binding.ownerEmail, binding.scope), RESTORE_FALLBACK_DEPTH + 1).all<{ backup_id: string; backup_dir: string }>()
    .then((rows) => rows.results ?? [])
    .catch(() => []);
  const ordered = [latest ? { backupId: latest.backup_id, backupDir: latest.backup_dir } : null, ...history.map((row) => ({ backupId: row.backup_id, backupDir: row.backup_dir }))]
    .filter((candidate): candidate is WorkspaceSnapshotManifest => candidate !== null);
  const seen = new Set<string>();
  return ordered.filter((candidate) => !seen.has(candidate.backupId) && seen.add(candidate.backupId)).slice(0, RESTORE_FALLBACK_DEPTH);
}

async function restoreWithFallback(db: D1Database, binding: WorkspaceBinding, sandbox: BootSandbox): Promise<void> {
  const candidates = await restoreCandidates(db, binding);
  let destroyedBrokenContainer = false;
  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const receipt = verifyWorkspaceRestore(candidate, await sandbox.restoreBackup({ id: candidate.backupId, dir: candidate.backupDir }) as never);
        console.info("workspace.restore_verified", receipt);
        return;
      } catch (err) {
        console.error("workspace.restore_failed", { scope: binding.scope, backupId: candidate.backupId, attempt, err: String(err) });
        if (!destroyedBrokenContainer) {
          destroyedBrokenContainer = true;
          await sandbox.destroy().catch((destroyError: unknown) => console.error("workspace.destroy_after_restore_failure_failed", { err: String(destroyError) }));
          continue;
        }
        break;
      }
    }
  }
  if (candidates.length) console.error("workspace.restore_unavailable_continuing", { scope: binding.scope, tried: candidates.map((candidate) => candidate.backupId) });
}

export type BootReport = { recycled: boolean };

export async function bootWorkspace(db: D1Database, binding: WorkspaceBinding, sandbox: BootSandbox, options: { restoreLatest: boolean }): Promise<BootReport> {
  const { scope } = binding;
  const acquireStarted = Date.now();
  const ready = await sandbox.exec(readyMarkerCheckCommand(READY_MARKER), { cwd: "/", timeout: 10_000, origin: "internal" }).catch(() => null);
  const recycled = ready?.exitCode !== 0;
  const note = async (name: string, started: number, outcome: string, message?: string) => recycled && recordObserveEvent(db, { ownerEmail: binding.ownerEmail, sessionId: scope.kind === "chat" ? scope.chatId : null, kind: "workspace", name, durationMs: Date.now() - started, outcome, message }).catch(() => undefined);
  await note("fresh-container", acquireStarted, ready ? "ok" : "unreachable", `scope ${scope.kind}`);
  if (!recycled) return { recycled };
  const restoredFromDiskSnapshot = await sandbox.restoredFromDiskSnapshot().catch(() => null);
  const lastBackupBytes = (await latestSnapshotRow(db, binding).catch(() => null))?.size_bytes ?? null;
  const bootHomeBytes = restoredFromDiskSnapshot ? await measureHomeBytes(sandbox) : null;
  const restoreNeeded = shouldRestoreDirectoryBackup({ restoredFromDiskSnapshot, homeBytes: bootHomeBytes, lastBackupBytes });
  if (restoredFromDiskSnapshot && !restoreNeeded) await note("restore", acquireStarted, "skipped", `booted from disk snapshot ${restoredFromDiskSnapshot} with ${bootHomeBytes} bytes in home`);
  if (options.restoreLatest && restoreNeeded) {
    const restoreStarted = Date.now();
    try {
      await restoreWithFallback(db, binding, sandbox);
      const restoredHomeBytes = await measureHomeBytes(sandbox);
      const wiped = homeLooksWiped(restoredHomeBytes, lastBackupBytes);
      await note("restore", restoreStarted, wiped ? "empty" : "ok", `${restoredHomeBytes} bytes in home, last backup ${lastBackupBytes} bytes`);
      if (wiped) await note("reset", restoreStarted, "error", `home has ${restoredHomeBytes} bytes after restore; last good backup was ${lastBackupBytes} bytes`);
    } catch (error) {
      await note("restore", restoreStarted, "error", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  const initStarted = Date.now();
  const initialized = await sandbox.exec(workspaceInitCommand(WORKSPACE_HOME, READY_MARKER), { cwd: "/", timeout: 30_000, origin: "internal" }).catch(async (error: unknown) => {
    await note("init", initStarted, "error", error instanceof Error ? error.message : String(error));
    throw error;
  });
  await note("init", initStarted, initialized.exitCode === 0 ? "ok" : "error", initialized.exitCode === 0 ? undefined : initialized.stderr);
  if (initialized.exitCode !== 0) throw new Error(initialized.stderr || "Workspace initialization failed");
  return { recycled };
}

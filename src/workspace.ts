import type { DirectoryBackup } from "@cloudflare/sandbox";
import type { AccessIdentity } from "./auth";
import type { Env } from "./types";
import { Effect } from "effect";
import { databaseLayer } from "./effect/database";
import { publishWorkspaceSnapshot } from "./workspace-snapshot-program";
import { recordObserveEvent } from "./observe-events";
import { verifyWorkspaceRestore } from "./workspace-snapshot";
import { latestSnapshotRow } from "./workspace-boot";
import { workspaceFor, type WorkspaceStub } from "./workspace-object";

import { WORKSPACE_HOME, assertSeedablePath } from "./workspace-path";
import { REBUILDABLE_BACKUP_EXCLUDES, decideSnapshotPublish, homeLooksWiped, turnSnapshotDue, workspaceSnapshotKey, type WorkspaceScope } from "./workspace-policy";
export { WORKSPACE_HOME, assertSeedablePath };
export { workspaceFor, type WorkspaceStub };
const SNAPSHOT_TTL_SECONDS = 30 * 24 * 60 * 60;

const OWNER_SCOPE: WorkspaceScope = { kind: "owner" };

function binding(identity: AccessIdentity, scope: WorkspaceScope) {
  return { ownerEmail: identity.email, scope };
}

export async function stopUserWorkspace(env: Env, identity: AccessIdentity, scope: WorkspaceScope = OWNER_SCOPE): Promise<void> {
  await (await workspaceFor(env, identity, scope)).stopContainer();
}

export type WorkspaceSnapshotOutcome =
  | { published: true; backup: DirectoryBackup; sizeBytes: number }
  | { published: false; reason: "cooldown" | "shrink_refused"; sizeBytes?: number; previousBytes?: number };

export async function snapshotUserWorkspace(
  env: Env,
  identity: AccessIdentity,
  name = "auto",
  options?: { scope?: WorkspaceScope; respectCooldown?: boolean },
): Promise<DirectoryBackup> {
  const outcome = await snapshotWorkspace(env, identity, name, { ...options, respectCooldown: options?.respectCooldown ?? false });
  if (!outcome.published) throw new Error(`workspace snapshot not published: ${outcome.reason}`);
  return outcome.backup;
}

type DiskState = { managed: boolean; bootSnapshot: string | null; restoredFrom: string | null };

export async function workspaceDiskState(env: Env, identity: AccessIdentity, scope: WorkspaceScope): Promise<DiskState> {
  return (await workspaceFor(env, identity, scope)).diskState();
}

export async function saveWorkspaceDisk(env: Env, identity: AccessIdentity, scope: WorkspaceScope, name: string): Promise<{ id: string; size: number } | null> {
  const workspace = await workspaceFor(env, identity, scope);
  const lastBackupBytes = (await latestSnapshotRow(env.DB, binding(identity, scope)).catch(() => null))?.size_bytes ?? null;
  const homeBytes = await workspace.homeBytes();
  if (homeLooksWiped(homeBytes, lastBackupBytes)) {
    await recordObserveEvent(env.DB, { ownerEmail: identity.email, sessionId: scope.kind === "chat" ? scope.chatId : null, kind: "workspace", name: "disk-snapshot", outcome: "shrink_refused", message: `${lastBackupBytes} -> ${homeBytes} bytes in home` }).catch(() => undefined);
    return null;
  }
  const saved = await workspace.saveDisk(`my-ax-${name}-${Date.now()}`);
  if (saved) await recordObserveEvent(env.DB, { ownerEmail: identity.email, sessionId: scope.kind === "chat" ? scope.chatId : null, kind: "workspace", name: "disk-snapshot", outcome: "ok", message: `${saved.id} ${saved.size} bytes` }).catch(() => undefined);
  return saved;
}

export async function copyWorkspaceDisk(env: Env, identity: AccessIdentity, from: WorkspaceScope, to: WorkspaceScope): Promise<string | null> {
  const saved = await saveWorkspaceDisk(env, identity, from, "fork").catch(() => null);
  const snapshotId = saved?.id ?? await (await workspaceFor(env, identity, from)).bootSnapshot();
  if (snapshotId) await (await workspaceFor(env, identity, to)).bootFrom(snapshotId);
  return snapshotId;
}

export async function snapshotWorkspace(
  env: Env,
  identity: AccessIdentity,
  name: string,
  options?: { scope?: WorkspaceScope; respectCooldown?: boolean },
): Promise<WorkspaceSnapshotOutcome> {
  const scope = options?.scope ?? OWNER_SCOPE;
  const previous = await latestSnapshotRow(env.DB, binding(identity, scope));
  if (options?.respectCooldown && previous && !turnSnapshotDue(Date.parse(`${previous.updated_at}Z`), Date.now())) {
    return { published: false, reason: "cooldown" };
  }
  const workspace = await workspaceFor(env, identity, scope);
  const knownSize = await workspace.homeBytes().catch(() => null) ?? 0;
  const decision = decideSnapshotPublish(previous?.size_bytes ?? null, knownSize);
  if (!decision.publish) {
    console.error("workspace_snapshot_shrink_refused", { email: identity.email, scope, previousBytes: decision.previousBytes, nextBytes: decision.nextBytes });
    await recordObserveEvent(env.DB, { ownerEmail: identity.email, sessionId: scope.kind === "chat" ? scope.chatId : null, kind: "workspace", name: "snapshot", outcome: "shrink_refused", message: `${decision.previousBytes} -> ${decision.nextBytes} bytes` }).catch(() => undefined);
    return { published: false, reason: "shrink_refused", sizeBytes: knownSize, previousBytes: decision.previousBytes };
  }
  const backup = await workspace.backup({
    dir: WORKSPACE_HOME,
    name: `my-ax-${name}-${Date.now()}`,
    ttl: SNAPSHOT_TTL_SECONDS,
    gitignore: false,
    excludes: [...REBUILDABLE_BACKUP_EXCLUDES],
    compression: { format: "zstd" },
    multipart: true,
  });
  await Effect.runPromise(
    publishWorkspaceSnapshot(workspaceSnapshotKey(identity.email, scope), backup, knownSize, name).pipe(Effect.provide(databaseLayer(env.DB))),
  );
  return { published: true, backup, sizeBytes: knownSize };
}

export interface SeedFileInput {
  path: string;
  content: string;
}

export interface SeedFileResult {
  path: string;
  bytesWritten: number;
  snapshot: DirectoryBackup;
  verified: boolean;
  /** Whether the post-restore read matched the written content. The endpoint
   *  is the durability contract — if this is false, the snapshot exists but
   *  doesn't actually round-trip the bytes, which is exactly the regression
   *  the validation path is meant to catch. */
  restoreMatches: boolean;
  durationMs: number;
}

/** Durable owner-scoped file seed.
 *
 *  Algorithm (mirrors workspace-restore-probe but parameterized):
 *    1. Open workspace with restoreLatest:false so we don't clobber the mutation
 *       with a stale snapshot before we even write.
 *    2. mkdir -p the parent and writeFile().
 *    3. createBackup() from the same handle (snapshotUserWorkspace also passes
 *       restoreLatest:false so the snapshot reflects the just-written state).
 *    4. stop the live container.
 *    5. awake() again — the default restoreLatest:true now pulls the
 *       freshly-saved snapshot, which is the real durability validation.
 *    6. readFile() and byte-compare against what we wrote.
 *
 *  Step 1 is required: restoreLatest:false prevents a previous snapshot from
 *  being overlaid before the write, making the seed the new ground truth.
 */
export async function seedUserWorkspaceFile(
  env: Env,
  identity: AccessIdentity,
  input: SeedFileInput,
): Promise<SeedFileResult> {
  assertSeedablePath(input.path);
  if (typeof input.content !== "string") {
    throw new Error("content must be a string");
  }
  const started = Date.now();

  const workspace = await workspaceFor(env, identity);
  await workspace.awake({ restoreLatest: false });
  await workspace.write(input.path, input.content);

  const snapshot = await snapshotUserWorkspace(env, identity, "seed");

  await workspace.stopContainer();
  await workspace.awake({ restoreLatest: true });
  const restoredContent = await workspace.read(input.path);
  const restoreMatches = restoredContent === input.content;

  return {
    path: input.path,
    bytesWritten: input.content.length,
    snapshot,
    verified: restoreMatches,
    restoreMatches,
    durationMs: Date.now() - started,
  };
}

export type WorkspaceSnapshotListing = { backupId: string; name: string; sizeBytes: number | null; createdAt: string; latest: boolean };

export async function listWorkspaceSnapshots(env: Env, identity: AccessIdentity, limit = 20, scope: WorkspaceScope = OWNER_SCOPE): Promise<WorkspaceSnapshotListing[]> {
  const latest = await latestSnapshotRow(env.DB, binding(identity, scope));
  const rows = await env.DB.prepare(
    "SELECT backup_id, name, size_bytes, created_at FROM workspace_snapshot_history WHERE workspace_key = ? ORDER BY id DESC LIMIT ?",
  ).bind(workspaceSnapshotKey(identity.email, scope), Math.min(Math.max(limit, 1), 100)).all<{ backup_id: string; name: string | null; size_bytes: number | null; created_at: string }>();
  return (rows.results ?? []).map((row) => ({ backupId: row.backup_id, name: row.name ?? "", sizeBytes: row.size_bytes, createdAt: row.created_at, latest: row.backup_id === latest?.backup_id }));
}

export async function restoreWorkspaceSnapshot(env: Env, identity: AccessIdentity, backupId: string, scope: WorkspaceScope = OWNER_SCOPE): Promise<{ backupId: string; savedCurrentAs: string | null }> {
  const key = workspaceSnapshotKey(identity.email, scope);
  const row = await env.DB.prepare(
    "SELECT backup_id, backup_dir, size_bytes FROM workspace_snapshot_history WHERE workspace_key = ? AND backup_id = ? ORDER BY id DESC LIMIT 1",
  ).bind(key, backupId).first<{ backup_id: string; backup_dir: string; size_bytes: number | null }>();
  if (!row) throw new Error("snapshot not found for this workspace");
  const saved = await snapshotWorkspace(env, identity, "before-restore", { scope });
  const workspace = await workspaceFor(env, identity, scope);
  verifyWorkspaceRestore({ backupId: row.backup_id, backupDir: row.backup_dir }, await workspace.restore({ id: row.backup_id, dir: row.backup_dir }) as never);
  await Effect.runPromise(
    publishWorkspaceSnapshot(key, { id: row.backup_id, dir: row.backup_dir }, row.size_bytes, "restored").pipe(Effect.provide(databaseLayer(env.DB))),
  );
  return { backupId: row.backup_id, savedCurrentAs: saved.published ? saved.backup.id : null };
}

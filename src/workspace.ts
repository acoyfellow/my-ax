import { getSandbox, type DirectoryBackup, type Sandbox } from "@cloudflare/sandbox";
import { workspaceInitCommand } from "./workspace-init";
import type { AccessIdentity } from "./auth";
import type { Env } from "./types";
import { Effect } from "effect";
import { databaseLayer } from "./effect/database";
import { publishWorkspaceSnapshot } from "./workspace-snapshot-program";
import { verifyWorkspaceRestore, type WorkspaceSnapshotManifest } from "./workspace-snapshot";

import { WORKSPACE_HOME, assertSeedablePath } from "./workspace-path";
import { REBUILDABLE_BACKUP_EXCLUDES, decideSnapshotPublish, turnSnapshotDue, workspaceSandboxId, workspaceSnapshotKey, type WorkspaceScope } from "./workspace-policy";
export { WORKSPACE_HOME, assertSeedablePath };
const SNAPSHOT_TTL_SECONDS = 30 * 24 * 60 * 60;
const READY_MARKER = "/tmp/my-ax-workspace-ready";

const OWNER_SCOPE: WorkspaceScope = { kind: "owner" };

function key(identity: AccessIdentity, scope: WorkspaceScope = OWNER_SCOPE): string {
  return workspaceSandboxId(identity.email, scope);
}

function handle(env: Env, identity: AccessIdentity, scope: WorkspaceScope = OWNER_SCOPE) {
  return getSandbox(
    (env as unknown as { SANDBOX: DurableObjectNamespace<Sandbox> }).SANDBOX,
    key(identity, scope),
    {
      containerTimeouts: { instanceGetTimeoutMS: 120_000, portReadyTimeoutMS: 240_000 },
      transport: "rpc",
    },
  );
}

// Only dedupe concurrent readiness work inside the same event turn. Caching a
// Promise that closes over D1/RPC I/O across Durable Object events triggers
// Workers' cross-request/cross-DO I/O guard on later chat turns.
const preparing = new Map<string, Promise<void>>();

export function invalidateUserWorkspace(identity: AccessIdentity, scope: WorkspaceScope = OWNER_SCOPE): void {
  preparing.delete(key(identity, scope));
}

type SnapshotRow = { backup_id: string; backup_dir: string; size_bytes: number | null; updated_at: string };

async function latestSnapshotRow(env: Env, identity: AccessIdentity, scope: WorkspaceScope): Promise<SnapshotRow | null> {
  return env.DB.prepare(
    "SELECT backup_id, backup_dir, size_bytes, updated_at FROM workspace_snapshots WHERE owner_email = ?",
  ).bind(workspaceSnapshotKey(identity.email, scope)).first<SnapshotRow>();
}

async function latestSnapshot(env: Env, identity: AccessIdentity, scope: WorkspaceScope): Promise<WorkspaceSnapshotManifest | null> {
  const row = await latestSnapshotRow(env, identity, scope);
  return row ? { backupId: row.backup_id, backupDir: row.backup_dir } : null;
}

function workspaceSizeCommand(): string {
  const excludes = REBUILDABLE_BACKUP_EXCLUDES.map((pattern) => `--exclude=${JSON.stringify(pattern)}`).join(" ");
  return `du -sb ${excludes} ${WORKSPACE_HOME} 2>/dev/null | cut -f1`;
}

const RESTORE_FALLBACK_DEPTH = 3;

async function restoreCandidates(env: Env, identity: AccessIdentity, scope: WorkspaceScope): Promise<WorkspaceSnapshotManifest[]> {
  const latest = await latestSnapshot(env, identity, scope);
  const history = await env.DB.prepare(
    "SELECT backup_id, backup_dir FROM workspace_snapshot_history WHERE workspace_key = ? ORDER BY id DESC LIMIT ?",
  ).bind(workspaceSnapshotKey(identity.email, scope), RESTORE_FALLBACK_DEPTH + 1).all<{ backup_id: string; backup_dir: string }>()
    .then((rows) => rows.results ?? [])
    .catch(() => []);
  const ordered = [latest, ...history.map((row) => ({ backupId: row.backup_id, backupDir: row.backup_dir }))]
    .filter((candidate): candidate is WorkspaceSnapshotManifest => candidate !== null);
  const seen = new Set<string>();
  return ordered.filter((candidate) => !seen.has(candidate.backupId) && seen.add(candidate.backupId)).slice(0, RESTORE_FALLBACK_DEPTH);
}

async function restoreWithFallback(env: Env, identity: AccessIdentity, scope: WorkspaceScope, sandbox: ReturnType<typeof handle>): Promise<void> {
  const candidates = await restoreCandidates(env, identity, scope);
  let destroyedBrokenContainer = false;
  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const receipt = verifyWorkspaceRestore(candidate, await sandbox.restoreBackup({ id: candidate.backupId, dir: candidate.backupDir }));
        console.info("workspace.restore_verified", receipt);
        return;
      } catch (err) {
        console.error("workspace.restore_failed", { email: identity.email, scope, backupId: candidate.backupId, attempt, err: String(err) });
        if (!destroyedBrokenContainer) {
          destroyedBrokenContainer = true;
          await sandbox.destroy().catch((destroyError: unknown) => console.error("workspace.destroy_after_restore_failure_failed", { err: String(destroyError) }));
          continue;
        }
        break;
      }
    }
  }
  if (candidates.length) console.error("workspace.restore_unavailable_continuing", { email: identity.email, scope, tried: candidates.map((candidate) => candidate.backupId) });
}

export async function getUserWorkspace(env: Env, identity: AccessIdentity, options?: { restoreLatest?: boolean; scope?: WorkspaceScope }) {
  const scope = options?.scope ?? OWNER_SCOPE;
  const id = key(identity, scope);
  const sandbox = handle(env, identity, scope);
  const inFlight = preparing.get(id);
  if (inFlight) {
    await inFlight;
    return { sandbox, home: WORKSPACE_HOME, recycled: false };
  }
  let recycled = false;
  const promise = (async () => {
    // Restore only when acquiring a fresh container. Re-applying the latest
    // backup before every tool call resurrects files intentionally deleted by
    // an earlier tool in the same turn. A /tmp marker survives calls within a
    // live container but disappears naturally when Sandbox recycles it.
    const ready = await sandbox.exec(`test -f ${READY_MARKER}`, { cwd: "/", timeout: 10_000, origin: "internal" }).catch(() => null);
    recycled = ready?.exitCode !== 0;
    if (options?.restoreLatest !== false && ready?.exitCode !== 0) {
      await restoreWithFallback(env, identity, scope, sandbox);
    }
    const initialized = await sandbox.exec(workspaceInitCommand(WORKSPACE_HOME, READY_MARKER), {
      cwd: "/",
      timeout: 30_000,
      origin: "internal",
    });
    if (initialized.exitCode !== 0) throw new Error(initialized.stderr || "Workspace initialization failed");
  })();
  preparing.set(id, promise);
  try {
    await promise;
  } finally {
    preparing.delete(id);
  }
  return { sandbox, home: WORKSPACE_HOME, recycled };
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

export async function snapshotWorkspace(
  env: Env,
  identity: AccessIdentity,
  name: string,
  options?: { scope?: WorkspaceScope; respectCooldown?: boolean },
): Promise<WorkspaceSnapshotOutcome> {
  const scope = options?.scope ?? OWNER_SCOPE;
  const previous = await latestSnapshotRow(env, identity, scope);
  if (options?.respectCooldown && previous && !turnSnapshotDue(Date.parse(`${previous.updated_at}Z`), Date.now())) {
    return { published: false, reason: "cooldown" };
  }
  const { sandbox } = await getUserWorkspace(env, identity, { scope });
  const measured = await sandbox.exec(workspaceSizeCommand(), { cwd: "/", timeout: 20_000, origin: "internal" }).catch(() => null);
  const sizeBytes = Number.parseInt(measured?.stdout?.trim() ?? "", 10);
  const knownSize = Number.isFinite(sizeBytes) ? sizeBytes : 0;
  const decision = decideSnapshotPublish(previous?.size_bytes ?? null, knownSize);
  if (!decision.publish) {
    console.error("workspace_snapshot_shrink_refused", { email: identity.email, scope, previousBytes: decision.previousBytes, nextBytes: decision.nextBytes });
    return { published: false, reason: "shrink_refused", sizeBytes: knownSize, previousBytes: decision.previousBytes };
  }
  const backup = await sandbox.createBackup({
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
 *    4. destroy() the live sandbox and invalidate the readiness cache.
 *    5. getUserWorkspace() again — the default restoreLatest:true now pulls the
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

  const fresh = await getUserWorkspace(env, identity, { restoreLatest: false });
  const parent = input.path.slice(0, input.path.lastIndexOf("/")) || WORKSPACE_HOME;
  await fresh.sandbox.exec(`mkdir -p ${JSON.stringify(parent)}`, {
    cwd: "/",
    timeout: 30_000,
    origin: "internal",
  });
  await fresh.sandbox.writeFile(input.path, input.content);

  const snapshot = await snapshotUserWorkspace(env, identity, "seed");

  await fresh.sandbox.destroy();
  invalidateUserWorkspace(identity);

  const restored = await getUserWorkspace(env, identity);
  const read = await restored.sandbox.readFile(input.path);
  const restoredContent = (read as unknown as { content?: string }).content ?? "";
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

import { getSandbox, type DirectoryBackup, type Sandbox } from "@cloudflare/sandbox";
import type { AccessIdentity } from "./auth";
import type { Env } from "./types";
import { publishWorkspaceSnapshot } from "./workspace-snapshot";

export const WORKSPACE_HOME = "/home/user";
const SNAPSHOT_TTL_SECONDS = 30 * 24 * 60 * 60;
const READY_MARKER = "/tmp/my-ax-workspace-ready";

function key(identity: AccessIdentity): string {
  return identity.email.toLowerCase();
}

function handle(env: Env, identity: AccessIdentity) {
  return getSandbox(
    (env as unknown as { SANDBOX: DurableObjectNamespace<Sandbox> }).SANDBOX,
    key(identity),
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

export function invalidateUserWorkspace(identity: AccessIdentity): void {
  preparing.delete(key(identity));
}

async function latestSnapshot(env: Env, identity: AccessIdentity): Promise<DirectoryBackup | null> {
  const row = await env.DB.prepare(
    "SELECT backup_id, backup_dir FROM workspace_snapshots WHERE owner_email = ?",
  ).bind(key(identity)).first<{ backup_id: string; backup_dir: string }>();
  return row ? { id: row.backup_id, dir: row.backup_dir } : null;
}

export async function getUserWorkspace(env: Env, identity: AccessIdentity, options?: { restoreLatest?: boolean }) {
  const id = key(identity);
  const sandbox = handle(env, identity);
  const inFlight = preparing.get(id);
  if (inFlight) {
    await inFlight;
    return { sandbox, home: WORKSPACE_HOME };
  }
  const promise = (async () => {
    // Restore only when acquiring a fresh container. Re-applying the latest
    // backup before every tool call resurrects files intentionally deleted by
    // an earlier tool in the same turn. A /tmp marker survives calls within a
    // live container but disappears naturally when Sandbox recycles it.
    const ready = await sandbox.exec(`test -f ${READY_MARKER}`, { cwd: "/", timeout: 10_000, origin: "internal" }).catch(() => null);
    const snapshot = options?.restoreLatest === false || ready?.exitCode === 0 ? null : await latestSnapshot(env, identity);
    if (snapshot) {
      try {
        await sandbox.restoreBackup(snapshot);
      } catch (err) {
        console.error("workspace.restore_failed", { email: identity.email, backupId: snapshot.id, err: String(err) });
        // Never bless an empty/partial workspace as ready after restore failed.
        // Leave the marker absent so the next acquisition retries restoration,
        // and prevent a subsequent turn from snapshotting empty state over the
        // latest durable pointer.
        throw new Error(`Workspace restore failed for backup ${snapshot.id}`);
      }
    }
    const initialized = await sandbox.exec(`mkdir -p ${WORKSPACE_HOME}/.config ${WORKSPACE_HOME}/.my-ax/conversations && touch ${READY_MARKER}`, {
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
  return { sandbox, home: WORKSPACE_HOME };
}

export async function snapshotUserWorkspace(env: Env, identity: AccessIdentity, name = "auto") {
  const { sandbox } = await getUserWorkspace(env, identity, { restoreLatest: false });
  const backup = await sandbox.createBackup({
    dir: WORKSPACE_HOME,
    name: `my-ax-${name}-${Date.now()}`,
    ttl: SNAPSHOT_TTL_SECONDS,
    gitignore: true,
    excludes: ["node_modules", ".cache", "*.log"],
    compression: { format: "zstd" },
    multipart: true,
  });
  await publishWorkspaceSnapshot(env.DB, key(identity), backup);
  return backup;
}

/** Reject anything that isn't strictly inside /home/user. We keep this very
 *  conservative on purpose: the seed endpoint is owner-scoped but still talks
 *  to a shared overlay primitive, so traversal/symlink-style escapes have to
 *  fail closed at the API edge. */
export function assertSeedablePath(path: string): asserts path is string {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("path must be a non-empty string");
  }
  if (!path.startsWith(`${WORKSPACE_HOME}/`)) {
    throw new Error(`path must be inside ${WORKSPACE_HOME}/`);
  }
  // Disallow .. segments and NUL — block traversal even if the prefix matches.
  if (path.includes("/../") || path.endsWith("/..") || path.includes("\0")) {
    throw new Error("path must not contain traversal segments");
  }
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

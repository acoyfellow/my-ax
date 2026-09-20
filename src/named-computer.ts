import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import type { AccessIdentity } from "./auth";
import { computerSandboxName, normalizeComputerId, shouldRestoreComputerSnapshot } from "./computer-id";
import type { Env } from "./types";
import { WORKSPACE_HOME } from "./workspace-path";
import { verifyWorkspaceRestore } from "./workspace-snapshot";

const SNAPSHOT_TTL_SECONDS = 30 * 24 * 60 * 60;
const READY_MARKER = "/tmp/my-ax-computer-ready";

function namespace(env: Env): DurableObjectNamespace<Sandbox> {
  const binding = (env as unknown as { NAMED_COMPUTER?: DurableObjectNamespace<Sandbox> }).NAMED_COMPUTER;
  if (!binding) throw new Error("NAMED_COMPUTER binding is not configured");
  return binding;
}

function handle(env: Env, identity: AccessIdentity, computerId: string) {
  return getSandbox(namespace(env), computerSandboxName(identity.email, computerId), {
    containerTimeouts: { instanceGetTimeoutMS: 120_000, portReadyTimeoutMS: 240_000 },
    transport: "rpc",
  });
}

async function latestSnapshot(env: Env, identity: AccessIdentity, computerId: string) {
  const row = await env.DB.prepare(
    "SELECT backup_id, backup_dir FROM computer_snapshots WHERE owner_email = ? AND computer_id = ?",
  ).bind(identity.email.toLowerCase(), computerId).first<{ backup_id: string; backup_dir: string }>();
  return row ? { backupId: row.backup_id, backupDir: row.backup_dir } : null;
}

export async function getNamedComputer(env: Env, identity: AccessIdentity, rawId: string, options?: { restoreLatest?: boolean }) {
  const computerId = normalizeComputerId(rawId);
  const sandbox = handle(env, identity, computerId);
  const ready = await sandbox.exec(`test -f ${READY_MARKER}`, { cwd: "/", timeout: 10_000, origin: "internal" }).catch(() => null);
  const readyCode = ready?.exitCode ?? null;
  const snapshot = shouldRestoreComputerSnapshot(options?.restoreLatest, readyCode)
    ? await latestSnapshot(env, identity, computerId)
    : null;
  if (snapshot) {
    const receipt = verifyWorkspaceRestore(snapshot, await sandbox.restoreBackup({ id: snapshot.backupId, dir: snapshot.backupDir }));
    console.info("named_computer.restore_verified", { computerId, ...receipt });
  }
  const initialized = await sandbox.exec(`mkdir -p ${WORKSPACE_HOME} && touch ${READY_MARKER}`, { cwd: "/", timeout: 30_000, origin: "internal" });
  if (initialized.exitCode !== 0) throw new Error(initialized.stderr || "computer initialization failed");
  await ensureComputerDisplay(sandbox);
  return { sandbox, home: WORKSPACE_HOME, computerId };
}

async function processRunning(sandbox: Sandbox, needle: string) {
  const listed = await sandbox.listProcesses().catch(() => []);
  return listed.some((proc) => (proc.command ?? "").includes(needle));
}

export async function ensureComputerDisplay(sandbox: Sandbox) {
  await sandbox.exec("mkdir -p /tmp/my-ax-vnc", { cwd: "/", timeout: 10_000, origin: "internal" });
  if (!(await processRunning(sandbox, "Xtigervnc"))) {
    await sandbox.startProcess(
      "Xtigervnc :1 -geometry 1280x800 -depth 24 -SecurityTypes None -localhost yes",
      { cwd: "/" },
    );
  }
  if (!(await processRunning(sandbox, "xfce"))) {
    await sandbox.startProcess("startxfce4", { cwd: "/", env: { DISPLAY: ":1" } });
  }
  if (!(await processRunning(sandbox, "websockify"))) {
    const novnc = await sandbox.startProcess(
      "websockify --web=/usr/share/novnc 6080 localhost:5901",
      { cwd: "/" },
    );
    await novnc.waitForPort(6080, { mode: "tcp" });
  }
}

export async function listNamedComputers(env: Env, identity: AccessIdentity) {
  const rows = await env.DB.prepare(
    "SELECT computer_id, backup_id, updated_at FROM computer_snapshots WHERE owner_email = ? ORDER BY updated_at DESC",
  ).bind(identity.email.toLowerCase()).all<{ computer_id: string; backup_id: string; updated_at: string }>();
  return rows.results ?? [];
}

export function computerPreviewSrc(computerId: string): string {
  return `/api/computers/${normalizeComputerId(computerId)}/novnc/vnc.html?autoconnect=1&resize=scale`;
}

export async function snapshotNamedComputer(env: Env, identity: AccessIdentity, rawId: string, name = "auto") {
  const { sandbox, computerId } = await getNamedComputer(env, identity, rawId, { restoreLatest: false });
  const backup = await sandbox.createBackup({
    dir: WORKSPACE_HOME,
    name: `computer-${computerId}-${name}-${Date.now()}`,
    ttl: SNAPSHOT_TTL_SECONDS,
    gitignore: false,
    excludes: [".cache", "*.log"],
    compression: { format: "zstd" },
    multipart: true,
  });
  await env.DB.prepare(
    `INSERT INTO computer_snapshots(owner_email, computer_id, backup_id, backup_dir, snapshot_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
     ON CONFLICT(owner_email, computer_id) DO UPDATE SET
       backup_id=excluded.backup_id,
       backup_dir=excluded.backup_dir,
       snapshot_version=computer_snapshots.snapshot_version + 1,
       updated_at=datetime('now')`,
  ).bind(identity.email.toLowerCase(), computerId, backup.id, backup.dir).run();
  return { computerId, backup };
}

export async function proveNamedComputerSleepWake(env: Env, identity: AccessIdentity, rawId: string, content: string) {
  const marker = `${WORKSPACE_HOME}/.my-ax-computer-proof`;
  const opened = await getNamedComputer(env, identity, rawId, { restoreLatest: false });
  await opened.sandbox.writeFile(marker, content);
  const snap = await snapshotNamedComputer(env, identity, opened.computerId, "proof");
  await opened.sandbox.exec(`rm -f ${READY_MARKER}`, { cwd: "/", timeout: 10_000, origin: "internal" });
  const restored = await getNamedComputer(env, identity, opened.computerId);
  const read = await restored.sandbox.readFile(marker);
  const restoredContent = (read as unknown as { content?: string }).content ?? "";
  if (restoredContent !== content) throw new Error("named computer restore did not match written file");
  return { computerId: opened.computerId, backupId: snap.backup.id, restoreMatches: true };
}

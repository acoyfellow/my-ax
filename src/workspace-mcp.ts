import { readBoundedWorkspaceFile } from "./workspace-read";
import { assertSeedablePath } from "./workspace-path";

const WORKSPACE_HOME = "/home/user";

export const WORKSPACE_ALIAS_ROOT = "/workspace";
export const WORKSPACE_LIST_MAX_ENTRIES = 200;
export const WORKSPACE_READ_MAX_BYTES = 32_000;

export type WorkspaceExec = {
  exec: (command: string, options: { cwd: string; timeout: number }) => Promise<{ exitCode?: number; stdout?: string; stderr?: string }>;
};

export type WorkspaceListEntry = {
  path: string;
  name: string;
  kind: "file" | "dir";
};

export function resolveWorkspacePath(input: string | undefined): string {
  const raw = (input ?? WORKSPACE_ALIAS_ROOT).trim() || WORKSPACE_ALIAS_ROOT;
  const aliased = raw === WORKSPACE_ALIAS_ROOT || raw.startsWith(`${WORKSPACE_ALIAS_ROOT}/`)
    ? `${WORKSPACE_HOME}${raw.slice(WORKSPACE_ALIAS_ROOT.length)}` || WORKSPACE_HOME
    : raw;
  if (aliased !== WORKSPACE_HOME && !aliased.startsWith(`${WORKSPACE_HOME}/`)) {
    throw new Error(`path must be inside ${WORKSPACE_ALIAS_ROOT} or ${WORKSPACE_HOME}`);
  }
  if (aliased.includes("\0") || aliased.includes("..")) {
    throw new Error("path must not contain .. or NUL");
  }
  return aliased === "" ? WORKSPACE_HOME : aliased;
}

export function publicWorkspacePath(abs: string): string {
  if (abs === WORKSPACE_HOME) return WORKSPACE_ALIAS_ROOT;
  if (abs.startsWith(`${WORKSPACE_HOME}/`)) return `${WORKSPACE_ALIAS_ROOT}${abs.slice(WORKSPACE_HOME.length)}`;
  return abs;
}

export async function listWorkspace(sandbox: WorkspaceExec, path?: string, limit = 80): Promise<{ path: string; entries: WorkspaceListEntry[]; truncated: boolean }> {
  const abs = resolveWorkspacePath(path);
  const cap = Math.max(1, Math.min(Number(limit) || 80, WORKSPACE_LIST_MAX_ENTRIES));
  const result = await sandbox.exec(
    `find ${shellQuote(abs)} -mindepth 1 -maxdepth 2 \\( -type f -o -type d \\) -print 2>/dev/null | head -n ${cap + 1}`,
    { cwd: WORKSPACE_HOME, timeout: 15_000 },
  );
  if (result.exitCode !== 0 && !(result.stdout ?? "").trim()) {
    throw new Error(result.stderr?.trim() || "workspace list failed");
  }
  const lines = (result.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const truncated = lines.length > cap;
  const entries: WorkspaceListEntry[] = lines.slice(0, cap).map((line) => {
    const name = line.slice(line.lastIndexOf("/") + 1);
    return { path: publicWorkspacePath(line), name, kind: "file" };
  });
  return { path: publicWorkspacePath(abs), entries, truncated };
}

export const WORKSPACE_WRITE_MAX_BYTES = 32_000;

export type WorkspaceWriteExec = WorkspaceExec & {
  writeFile?: (path: string, content: string) => Promise<unknown>;
};

export async function writeWorkspace(
  sandbox: WorkspaceWriteExec,
  path: string,
  content: string,
): Promise<{ path: string; bytesWritten: number }> {
  if (typeof content !== "string") throw new Error("content is required");
  if (content.length > WORKSPACE_WRITE_MAX_BYTES) {
    throw new Error(`content exceeds ${WORKSPACE_WRITE_MAX_BYTES} bytes`);
  }
  const abs = resolveWorkspacePath(path);
  if (abs === WORKSPACE_HOME) throw new Error("write requires a file path");
  assertSeedablePath(abs);
  const parent = abs.slice(0, abs.lastIndexOf("/")) || WORKSPACE_HOME;
  if (typeof sandbox.writeFile === "function") {
    const mkdir = await sandbox.exec(`mkdir -p ${shellQuote(parent)}`, { cwd: WORKSPACE_HOME, timeout: 15_000 });
    if (mkdir.exitCode !== 0) throw new Error(mkdir.stderr?.trim() || "workspace mkdir failed");
    await sandbox.writeFile(abs, content);
    return { path: publicWorkspacePath(abs), bytesWritten: content.length };
  }
  const result = await sandbox.exec(
    `mkdir -p ${shellQuote(parent)} && printf '%s' ${shellQuote(content)} > ${shellQuote(abs)}`,
    { cwd: WORKSPACE_HOME, timeout: 15_000 },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr?.trim() || "workspace write failed");
  return { path: publicWorkspacePath(abs), bytesWritten: content.length };
}

export async function readWorkspace(sandbox: WorkspaceExec, path: string, maxBytes = 8_000): Promise<{ path: string; content: string; truncated: boolean }> {
  const abs = resolveWorkspacePath(path);
  if (abs === WORKSPACE_HOME) throw new Error("read requires a file path");
  const cap = Math.max(1, Math.min(Number(maxBytes) || 8_000, WORKSPACE_READ_MAX_BYTES));
  const content = await readBoundedWorkspaceFile(sandbox, abs, cap + 1);
  if (content === null) throw new Error("file not found or not readable");
  const truncated = content.length > cap;
  return { path: publicWorkspacePath(abs), content: truncated ? content.slice(0, cap) : content, truncated };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

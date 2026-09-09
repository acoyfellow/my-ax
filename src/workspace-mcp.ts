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

export const WORKSPACE_WRITE_MAX_BYTES = 32_000;

export type WorkspaceWriteExec = WorkspaceExec & {
  writeFile?: (path: string, content: string) => Promise<unknown>;
};

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

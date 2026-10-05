import type { ShellResult } from "./types";

export interface WorkspaceExecResult extends ShellResult {
  error?: string;
  workspace_recycled?: true;
}

interface ExecCapable {
  exec(cmd: string, opts: Record<string, unknown>): Promise<{ stdout?: string; stderr?: string; exitCode?: number; success?: boolean }>;
}

export interface AcquiredWorkspace<S extends ExecCapable> {
  sandbox: S;
  recycled: boolean;
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause === undefined ? "" : `\ncause: ${errorText(error.cause)}`;
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}

function field<T>(error: unknown, name: string, guard: (value: unknown) => value is T): T | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as Record<string, unknown>)[name];
  return guard(value) ? value : undefined;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";

export function execFailureResult(error: unknown): WorkspaceExecResult {
  return {
    stdout: field(error, "stdout", isString) ?? "",
    stderr: field(error, "stderr", isString) ?? "",
    exitCode: field(error, "exitCode", isNumber) ?? -1,
    error: errorText(error),
  };
}

export async function workspaceShellExec<S extends ExecCapable>(
  acquire: () => Promise<AcquiredWorkspace<S>>,
  cmd: string,
  opts: Record<string, unknown>,
): Promise<WorkspaceExecResult> {
  let recycled = false;
  let result: WorkspaceExecResult;
  try {
    const workspace = await acquire();
    recycled = workspace.recycled;
    const raw = await workspace.sandbox.exec(cmd, opts);
    result = { stdout: raw.stdout ?? "", stderr: raw.stderr ?? "", exitCode: raw.exitCode ?? (raw.success ? 0 : 1) };
  } catch (error) {
    result = execFailureResult(error);
  }
  return recycled ? { ...result, workspace_recycled: true } : result;
}

const GLOB_CHARS = /[*?[{]/;

export function globSearchRoot(absolutePattern: string, fallbackRoot: string): string {
  const firstGlob = absolutePattern.search(GLOB_CHARS);
  if (firstGlob === -1) {
    const parent = absolutePattern.slice(0, absolutePattern.lastIndexOf("/"));
    return parent.startsWith(fallbackRoot) ? parent : fallbackRoot;
  }
  const literal = absolutePattern.slice(0, firstGlob);
  const root = literal.slice(0, literal.lastIndexOf("/")) || "/";
  return root.startsWith(fallbackRoot) ? root : fallbackRoot;
}

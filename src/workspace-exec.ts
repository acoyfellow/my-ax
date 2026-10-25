import type { ShellResult } from "./types";

export interface WorkspaceExecResult extends ShellResult {
  error?: string;
  workspace_recycled?: true;
}

export interface ShellCapable {
  shell(cmd: string, opts: Record<string, unknown>): Promise<{ stdout: string; stderr: string; exitCode: number; workspaceLost?: true }>;
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

const SHELL_EXITED_PATTERN = /shell exited \(exit code: (\d+|unknown)\)/i;

export function shellExitCode(error: unknown): number | undefined {
  const match = SHELL_EXITED_PATTERN.exec(errorText(error));
  if (!match) return undefined;
  return match[1] === "unknown" ? -1 : Number(match[1]);
}

export interface ShellExitedResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function execTreatingShellExitAsResult<T>(run: () => Promise<T>): Promise<T | ShellExitedResult> {
  try {
    return await run();
  } catch (error) {
    const exitCode = shellExitCode(error);
    if (exitCode === undefined) throw error;
    return { stdout: "", stderr: `[the command ended the shell with exit code ${exitCode}; the workspace and its files are unchanged and the next command starts a fresh shell]\n`, exitCode };
  }
}

export function execFailureResult(error: unknown): WorkspaceExecResult {
  return {
    stdout: field(error, "stdout", isString) ?? "",
    stderr: field(error, "stderr", isString) ?? "",
    exitCode: field(error, "exitCode", isNumber) ?? -1,
    error: errorText(error),
  };
}

export async function workspaceShellExec(
  acquire: () => Promise<ShellCapable>,
  cmd: string,
  opts: Record<string, unknown>,
): Promise<WorkspaceExecResult> {
  try {
    const workspace = await acquire();
    const requested = typeof opts.timeout === "number" && opts.timeout > 0 ? opts.timeout : undefined;
    const bounded = requested ? shellBoundedCommand(cmd, requested) : undefined;
    const raw = await workspace.shell(bounded?.command ?? cmd, bounded ? { ...opts, timeout: bounded.sandboxTimeoutMs } : opts);
    const result: WorkspaceExecResult = { stdout: raw.stdout, stderr: raw.stderr, exitCode: raw.exitCode };
    if (raw.workspaceLost) return { ...result, workspace_recycled: true };
    if (bounded && result.exitCode === 124) return { ...result, error: `Command timed out after ${requested}ms and was stopped; the workspace was not touched.` };
    return result;
  } catch (error) {
    return execFailureResult(error);
  }
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

export const IN_SHELL_TIMEOUT_GRACE_MS = 5_000;

export function shellBoundedCommand(cmd: string, timeoutMs: number): { command: string; sandboxTimeoutMs: number } {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const quoted = `'${cmd.replace(/'/g, `'\\''`)}'`;
  return { command: `timeout -k 2 ${seconds} bash -c ${quoted}`, sandboxTimeoutMs: seconds * 1000 + IN_SHELL_TIMEOUT_GRACE_MS };
}

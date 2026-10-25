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

const DEAD_SANDBOX_PATTERNS = [
  /durable object instance is no longer active/i,
  /websocket upgrade failed: 5\d\d/i,
  /container (is )?not (running|ready)/i,
  /network connection lost/i,
];

export function isDeadSandboxError(error: unknown): boolean {
  const text = errorText(error);
  return DEAD_SANDBOX_PATTERNS.some((pattern) => pattern.test(text));
}

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

export async function withSandboxRecovery<T>(run: () => Promise<T>, reset: () => Promise<void>): Promise<{ value: T; reset: boolean }> {
  try {
    return { value: await run(), reset: false };
  } catch (error) {
    if (!isDeadSandboxError(error)) throw error;
    await reset();
    return { value: await run(), reset: true };
  }
}

export interface RecoveringExecDeps<S> {
  acquire: () => Promise<S>;
  exec: (sandbox: S) => Promise<{ stdout?: string; stderr?: string; exitCode?: number }>;
  destroy: () => Promise<void>;
}

const RESET_NOTE = "[workspace was unreachable and was reset to a fresh container restored from the last snapshot; background processes from before were stopped]\n";
const DIED_MID_COMMAND_NOTE = "[the workspace container died while this command was running and was reset to a fresh container from the last snapshot; the command was not re-run because it may have partially completed. Check its effects before running it again.]\n";

export async function recoveringWorkspaceExec<S>(deps: RecoveringExecDeps<S>): Promise<{ stdout: string; stderr: string; exitCode: number; reset: boolean }> {
  let reset = false;
  let sandbox: S;
  try {
    sandbox = await deps.acquire();
  } catch (error) {
    if (!isDeadSandboxError(error)) throw error;
    await deps.destroy();
    reset = true;
    sandbox = await deps.acquire();
  }
  try {
    const value = await execTreatingShellExitAsResult(() => deps.exec(sandbox));
    return { stdout: value.stdout ?? "", stderr: `${reset ? RESET_NOTE : ""}${value.stderr ?? ""}`, exitCode: value.exitCode ?? -1, reset };
  } catch (error) {
    if (!isDeadSandboxError(error)) throw error;
    await deps.destroy();
    return { stdout: "", stderr: DIED_MID_COMMAND_NOTE, exitCode: -1, reset: true };
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
    const requested = typeof opts.timeout === "number" && opts.timeout > 0 ? opts.timeout : undefined;
    const bounded = requested ? shellBoundedCommand(cmd, requested) : undefined;
    const raw = await workspace.sandbox.exec(bounded?.command ?? cmd, bounded ? { ...opts, timeout: bounded.sandboxTimeoutMs } : opts);
    result = { stdout: raw.stdout ?? "", stderr: raw.stderr ?? "", exitCode: raw.exitCode ?? (raw.success ? 0 : 1) };
    if (bounded && result.exitCode === 124) result = { ...result, error: `Command timed out after ${requested}ms and was stopped; the workspace was not touched.` };
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

export const IN_SHELL_TIMEOUT_GRACE_MS = 5_000;

export function shellBoundedCommand(cmd: string, timeoutMs: number): { command: string; sandboxTimeoutMs: number } {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const quoted = `'${cmd.replace(/'/g, `'\\''`)}'`;
  return { command: `timeout -k 2 ${seconds} bash -c ${quoted}`, sandboxTimeoutMs: seconds * 1000 + IN_SHELL_TIMEOUT_GRACE_MS };
}

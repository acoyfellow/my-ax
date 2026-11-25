import { shellBoundedCommand } from "./workspace-exec";

export type KillableShellProcess = {
  id: string;
  pid?: number;
  status: string;
  exitCode?: number;
};

export type KillableShellWorkspace = {
  spawn(command: string, options: { cwd?: string; timeout?: number; autoCleanup?: boolean; env?: Record<string, string> }): Promise<KillableShellProcess>;
  processInfo(id: string): Promise<KillableShellProcess | null>;
  processOutput(id: string): Promise<{ stdout: string; stderr: string } | null>;
  stopProcess(id: string, signal: string): Promise<boolean>;
  shell(command: string, options: { cwd?: string; timeout?: number; env?: Record<string, string> }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
};

export type KillableShellResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  killedByOwner?: true;
  killMessage?: string;
};

const PARTIAL_OUTPUT_LIMIT = 400;

export function formatKilledByOwner(options: {
  tool: string;
  elapsedMs: number;
  terminated: boolean;
  stdout?: string;
  stderr?: string;
}): string {
  const secs = `${(Math.max(0, options.elapsedMs) / 1000).toFixed(1)}s`;
  const status = options.terminated
    ? "Underlying process terminated (SIGKILL)."
    : "Cancel sent; verify side effects before retrying.";
  const parts = [`Killed by owner after ${secs} (${options.tool}). ${status}`];
  const out = (options.stdout ?? "").trim();
  const err = (options.stderr ?? "").trim();
  if (out) parts.push(`Partial stdout: ${out.slice(-PARTIAL_OUTPUT_LIMIT)}`);
  if (err) parts.push(`Partial stderr: ${err.slice(-PARTIAL_OUTPUT_LIMIT)}`);
  parts.push("Do not automatically retry this command unless the owner asks.");
  return parts.join("\n");
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function processGroupWrappedCommand(command: string, timeoutMs: number): { command: string; sandboxTimeoutMs: number } {
  const bounded = shellBoundedCommand(command, timeoutMs);
  return {
    command: `if command -v setsid >/dev/null 2>&1; then exec setsid bash -c ${shellSingleQuote(bounded.command)}; else exec ${bounded.command}; fi`,
    sandboxTimeoutMs: bounded.sandboxTimeoutMs,
  };
}

function waitOrAbort(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function terminateProcessGroup(workspace: KillableShellWorkspace, proc: KillableShellProcess): Promise<boolean> {
  let killed = false;
  try {
    if (await workspace.stopProcess(proc.id, "SIGTERM")) killed = true;
  } catch {}
  if (typeof proc.pid === "number" && proc.pid > 1) {
    const pid = Math.trunc(proc.pid);
    try {
      await workspace.shell(`kill -TERM -${pid} ${pid} 2>/dev/null; sleep 0.2; kill -KILL -${pid} ${pid} 2>/dev/null || true`, { cwd: "/", timeout: 5_000 });
      killed = true;
    } catch {}
  }
  try {
    if (await workspace.stopProcess(proc.id, "SIGKILL")) killed = true;
  } catch {}
  return killed;
}

export async function runKillableWorkspaceShell(
  workspace: KillableShellWorkspace,
  command: string,
  options: { cwd?: string; timeoutMs?: number; env?: Record<string, string>; signal?: AbortSignal; pollMs?: number },
): Promise<KillableShellResult> {
  const startedAt = Date.now();
  const signal = options.signal;
  if (signal?.aborted) {
    return {
      stdout: "",
      stderr: "",
      exitCode: 137,
      killedByOwner: true,
      killMessage: formatKilledByOwner({ tool: "exec", elapsedMs: 0, terminated: true }),
    };
  }
  const timeoutMs = options.timeoutMs ?? 120_000;
  const wrapped = processGroupWrappedCommand(command, timeoutMs);
  const proc = await workspace.spawn(wrapped.command, {
    cwd: options.cwd,
    timeout: wrapped.sandboxTimeoutMs,
    autoCleanup: false,
    env: options.env,
  });

  const killNow = async (): Promise<KillableShellResult> => {
    const terminated = await terminateProcessGroup(workspace, proc);
    const logs = await workspace.processOutput(proc.id).catch(() => null);
    const stdout = logs?.stdout ?? "";
    const stderr = logs?.stderr ?? "";
    const killMessage = formatKilledByOwner({
      tool: "exec",
      elapsedMs: Date.now() - startedAt,
      terminated,
      stdout,
      stderr,
    });
    return { stdout, stderr, exitCode: 137, killedByOwner: true, killMessage };
  };

  if (signal?.aborted) return killNow();

  const hardDeadline = startedAt + wrapped.sandboxTimeoutMs + 5_000;
  let delay = options.pollMs ?? 100;
  while (Date.now() < hardDeadline) {
    const info = await workspace.processInfo(proc.id).catch(() => null);
    if (signal?.aborted) return killNow();
    if (!info || (info.status !== "running" && info.status !== "starting")) {
      const logs = await workspace.processOutput(proc.id).catch(() => null);
      return { stdout: logs?.stdout ?? "", stderr: logs?.stderr ?? "", exitCode: info?.exitCode ?? 0 };
    }
    const aborted = await waitOrAbort(delay, signal);
    if (aborted) return killNow();
    delay = Math.min(delay * 2, 500);
  }
  return killNow();
}

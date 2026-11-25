import { shellBoundedCommand } from "./workspace-exec";

export type KillableShellWorkspace = {
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

function safeTag(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "run";
}

export function pgidFileFor(tag: string): string {
  return `/tmp/myax-pgid-${safeTag(tag)}`;
}

export function processGroupWrappedCommand(command: string, timeoutMs: number, tag = "run"): { command: string; sandboxTimeoutMs: number; pgidFile: string } {
  const pgidFile = pgidFileFor(tag);
  const inner = `pg=$(ps -o pgid= -p $$ 2>/dev/null | tr -dc '0-9'); [ -n "$pg" ] && printf '%s' "$pg" > ${pgidFile}; trap 'rm -f ${pgidFile}' EXIT; ${command}`;
  const bounded = shellBoundedCommand(inner, timeoutMs);
  return {
    command: bounded.command,
    sandboxTimeoutMs: bounded.sandboxTimeoutMs,
    pgidFile,
  };
}

export function pgidKillCommand(pgidFile: string): string {
  return `pg=$(cat ${pgidFile} 2>/dev/null | tr -dc '0-9'); rm -f ${pgidFile}; mypg=$(ps -o pgid= -p $$ 2>/dev/null | tr -dc '0-9'); if [ -n "$pg" ] && [ "$pg" -gt 1 ] && [ "$pg" != "$mypg" ]; then kill -TERM -"$pg" 2>/dev/null; sleep 0.2; kill -KILL -"$pg" 2>/dev/null; echo KILLED:$pg; else echo NO_PGID; fi`;
}

export async function runKillableWorkspaceShell(
  workspace: KillableShellWorkspace,
  command: string,
  options: { cwd?: string; timeoutMs?: number; env?: Record<string, string>; signal?: AbortSignal; tag?: string },
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
  const tag = options.tag ?? crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const wrapped = processGroupWrappedCommand(command, timeoutMs, tag);
  const runPromise = workspace.shell(wrapped.command, {
    cwd: options.cwd,
    timeout: wrapped.sandboxTimeoutMs,
    env: options.env,
  });

  if (!signal) return runPromise;

  return new Promise<KillableShellResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      void (async () => {
        let terminated = false;
        try {
          const killed = await workspace.shell(pgidKillCommand(wrapped.pgidFile), { cwd: "/", timeout: 5_000 });
          terminated = killed.stdout.includes("KILLED:");
        } catch {}
        let timer: ReturnType<typeof setTimeout> | undefined;
        let partial: { stdout: string; stderr: string; exitCode: number } | null = null;
        try {
          partial = await Promise.race([
            runPromise.catch(() => null),
            new Promise<null>((r) => {
              timer = setTimeout(() => r(null), 1_000);
            }),
          ]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
        const killMessage = formatKilledByOwner({
          tool: "exec",
          elapsedMs: Date.now() - startedAt,
          terminated,
          stdout: partial?.stdout,
          stderr: partial?.stderr,
        });
        finish(() => resolve({
          stdout: partial?.stdout ?? "",
          stderr: partial?.stderr ?? "",
          exitCode: 137,
          killedByOwner: true,
          killMessage,
        }));
      })();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    runPromise.then(
      (result) => { if (!signal.aborted) finish(() => resolve(result)); },
      (error) => { if (!signal.aborted) finish(() => reject(error)); },
    );
  });
}

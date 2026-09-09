import { Context, Data, Effect, Layer } from "effect";
import { readBoundedWorkspaceFile } from "./workspace-read";
import {
  WORKSPACE_LIST_MAX_ENTRIES,
  WORKSPACE_READ_MAX_BYTES,
  WORKSPACE_WRITE_MAX_BYTES,
  publicWorkspacePath,
  resolveWorkspacePath,
  shellQuote,
  type WorkspaceExec,
  type WorkspaceListEntry,
  type WorkspaceWriteExec,
} from "./workspace-mcp";
import { assertSeedablePath } from "./workspace-path";

const WORKSPACE_HOME = "/home/user";

export class WorkspaceMcpError extends Data.TaggedError("WorkspaceMcpError")<{
  reason: string;
  cause?: unknown;
}> {
  override get message(): string {
    return this.reason;
  }
}

export class WorkspaceSandbox extends Context.Service<WorkspaceSandbox, WorkspaceWriteExec>()("my-ax/effect/WorkspaceSandbox") {}

export function workspaceSandboxLayer(sandbox: WorkspaceWriteExec): Layer.Layer<WorkspaceSandbox> {
  return Layer.succeed(WorkspaceSandbox, WorkspaceSandbox.of(sandbox));
}

function validate<A>(run: () => A): Effect.Effect<A, WorkspaceMcpError> {
  return Effect.try({
    try: run,
    catch: (cause) => new WorkspaceMcpError({
      reason: cause instanceof Error ? cause.message : String(cause),
      cause,
    }),
  });
}

function attempt<A>(run: () => Promise<A>, fallback: string): Effect.Effect<A, WorkspaceMcpError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new WorkspaceMcpError({ reason: fallback, cause }),
  });
}

export function listWorkspace(
  path?: string,
  limit = 80,
): Effect.Effect<{ path: string; entries: WorkspaceListEntry[]; truncated: boolean }, WorkspaceMcpError, WorkspaceSandbox> {
  return Effect.gen(function* () {
    const sandbox = yield* WorkspaceSandbox;
    const abs = yield* validate(() => resolveWorkspacePath(path));
    const cap = Math.max(1, Math.min(Number(limit) || 80, WORKSPACE_LIST_MAX_ENTRIES));
    const result = yield* attempt(() => sandbox.exec(
      `find ${shellQuote(abs)} -mindepth 1 -maxdepth 2 \\( -type d -printf 'd %p\\n' -o -type f -printf 'f %p\\n' \\) 2>/dev/null | head -n ${cap + 1}`,
      { cwd: WORKSPACE_HOME, timeout: 15_000 },
    ), "workspace list failed");
    if (result.exitCode !== 0 && !(result.stdout ?? "").trim()) {
      return yield* Effect.fail(new WorkspaceMcpError({ reason: result.stderr?.trim() || "workspace list failed" }));
    }
    const lines = (result.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    const truncated = lines.length > cap;
    const entries: WorkspaceListEntry[] = lines.slice(0, cap).map((line) => {
      const kind = line.startsWith("d ") ? "dir" : "file";
      const absPath = line.startsWith("d ") || line.startsWith("f ") ? line.slice(2) : line;
      return { path: publicWorkspacePath(absPath), name: absPath.slice(absPath.lastIndexOf("/") + 1), kind };
    });
    return { path: publicWorkspacePath(abs), entries, truncated };
  });
}

export function writeWorkspace(
  path: string,
  content: string,
): Effect.Effect<{ path: string; bytesWritten: number }, WorkspaceMcpError, WorkspaceSandbox> {
  return Effect.gen(function* () {
    const sandbox = yield* WorkspaceSandbox;
    if (typeof content !== "string") return yield* Effect.fail(new WorkspaceMcpError({ reason: "content is required" }));
    if (content.length > WORKSPACE_WRITE_MAX_BYTES) {
      return yield* Effect.fail(new WorkspaceMcpError({ reason: `content exceeds ${WORKSPACE_WRITE_MAX_BYTES} bytes` }));
    }
    const abs = yield* validate(() => resolveWorkspacePath(path));
    if (abs === WORKSPACE_HOME) return yield* Effect.fail(new WorkspaceMcpError({ reason: "write requires a file path" }));
    yield* validate(() => assertSeedablePath(abs));
    const parent = abs.slice(0, abs.lastIndexOf("/")) || WORKSPACE_HOME;
    if (typeof sandbox.writeFile === "function") {
      const mkdir = yield* attempt(() => sandbox.exec(`mkdir -p ${shellQuote(parent)}`, { cwd: WORKSPACE_HOME, timeout: 15_000 }), "workspace mkdir failed");
      if (mkdir.exitCode !== 0) return yield* Effect.fail(new WorkspaceMcpError({ reason: mkdir.stderr?.trim() || "workspace mkdir failed" }));
      yield* attempt(() => sandbox.writeFile!(abs, content), "workspace write failed");
      return { path: publicWorkspacePath(abs), bytesWritten: content.length };
    }
    const result = yield* attempt(() => sandbox.exec(
      `mkdir -p ${shellQuote(parent)} && printf '%s' ${shellQuote(content)} > ${shellQuote(abs)}`,
      { cwd: WORKSPACE_HOME, timeout: 15_000 },
    ), "workspace write failed");
    if (result.exitCode !== 0) return yield* Effect.fail(new WorkspaceMcpError({ reason: result.stderr?.trim() || "workspace write failed" }));
    return { path: publicWorkspacePath(abs), bytesWritten: content.length };
  });
}

export function readWorkspace(
  path: string,
  maxBytes = 8_000,
): Effect.Effect<{ path: string; content: string; truncated: boolean }, WorkspaceMcpError, WorkspaceSandbox> {
  return Effect.gen(function* () {
    const sandbox: WorkspaceExec = yield* WorkspaceSandbox;
    const abs = yield* validate(() => resolveWorkspacePath(path));
    if (abs === WORKSPACE_HOME) return yield* Effect.fail(new WorkspaceMcpError({ reason: "read requires a file path" }));
    const cap = Math.max(1, Math.min(Number(maxBytes) || 8_000, WORKSPACE_READ_MAX_BYTES));
    const content = yield* attempt(() => readBoundedWorkspaceFile(sandbox, abs, cap + 1), "workspace read failed");
    if (content === null) return yield* Effect.fail(new WorkspaceMcpError({ reason: "file not found or not readable" }));
    const truncated = content.length > cap;
    return { path: publicWorkspacePath(abs), content: truncated ? content.slice(0, cap) : content, truncated };
  });
}

import assert from "node:assert/strict";
import test from "node:test";
import { globSearchRoot, workspaceShellExec } from "./workspace-exec";

const HOME = "/home/user";

test("a thrown exec failure returns the full error, exit code, and captured output", async () => {
  const failure = Object.assign(new Error("Session sandbox-abc failed: container exited while running command because of an out-of-memory condition"), { exitCode: 137, stdout: "partial out", stderr: "Killed" });
  const result = await workspaceShellExec(async () => ({ recycled: false, sandbox: { exec: async () => { throw failure; } } }), "make", {});
  assert.equal(result.exitCode, 137);
  assert.equal(result.stdout, "partial out");
  assert.equal(result.stderr, "Killed");
  assert.match(result.error ?? "", /out-of-memory condition$/);
});

test("a failure while acquiring the workspace is returned instead of thrown", async () => {
  const result = await workspaceShellExec(async () => { throw new Error("restore failed", { cause: new Error("backup missing") }); }, "ls", {});
  assert.equal(result.exitCode, -1);
  assert.match(result.error ?? "", /restore failed[\s\S]*backup missing/);
});

test("a recycled sandbox is flagged with a typed workspace_recycled signal", async () => {
  const sandbox = { exec: async () => ({ stdout: "ok", stderr: "", exitCode: 0 }) };
  assert.equal((await workspaceShellExec(async () => ({ recycled: true, sandbox }), "ls", {})).workspace_recycled, true);
  assert.equal((await workspaceShellExec(async () => ({ recycled: false, sandbox }), "ls", {})).workspace_recycled, undefined);
});

test("glob search is rooted at the literal prefix of the pattern", () => {
  assert.equal(globSearchRoot("/home/user/projects/app/src/**/*.ts", HOME), "/home/user/projects/app/src");
  assert.equal(globSearchRoot("/home/user/*.md", HOME), HOME);
  assert.equal(globSearchRoot("/home/user/notes/todo.md", HOME), "/home/user/notes");
  assert.equal(globSearchRoot("/home/user/a/b[0-9]/c", HOME), "/home/user/a");
  assert.equal(globSearchRoot("/etc/*", HOME), HOME);
});

test("a timeout is enforced inside the shell, so the sandbox session is never killed by its own timeout", async () => {
  let sent: { cmd: string; opts: Record<string, unknown> } | undefined;
  const sandbox = { exec: async (cmd: string, opts: Record<string, unknown>) => { sent = { cmd, opts }; return { stdout: "", stderr: "", exitCode: 124 }; } };
  const result = await workspaceShellExec(async () => ({ sandbox, recycled: false }), "echo 'it' && sleep 30", { timeout: 5000 });
  assert.equal(sent!.cmd, `timeout -k 2 5 bash -c 'echo '\\''it'\\'' && sleep 30'`);
  assert.ok((sent!.opts.timeout as number) > 5000, "the sandbox timeout must be looser than the shell timeout");
  assert.equal(result.exitCode, 124);
  assert.match(result.error ?? "", /timed out after 5000ms/);
});

test("a dead sandbox error is recognised", async () => {
  const { isDeadSandboxError } = await import("./workspace-exec");
  assert.equal(isDeadSandboxError(new Error("Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.")), true);
  assert.equal(isDeadSandboxError(new Error("WebSocket upgrade failed: 500 Internal Server Error")), true);
  assert.equal(isDeadSandboxError(new Error("Session 'sandbox-chat-x' shell exited (exit code: 1)")), true);
  assert.equal(isDeadSandboxError(new Error("ENOENT: no such file")), false);
});

test("a dead sandbox is reset once and the call is retried", async () => {
  const { withSandboxRecovery } = await import("./workspace-exec");
  let calls = 0;
  let resets = 0;
  const outcome = await withSandboxRecovery(async () => {
    calls += 1;
    if (calls === 1) throw new Error("this Durable Object instance is no longer active");
    return "alive";
  }, async () => { resets += 1; });
  assert.deepEqual(outcome, { value: "alive", reset: true });
  assert.equal(resets, 1);
});

test("an ordinary error is not retried", async () => {
  const { withSandboxRecovery } = await import("./workspace-exec");
  let resets = 0;
  await assert.rejects(withSandboxRecovery(async () => { throw new Error("bad input"); }, async () => { resets += 1; }), /bad input/);
  assert.equal(resets, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { execTreatingShellExitAsResult, globSearchRoot, workspaceShellExec } from "./workspace-exec";

const HOME = "/home/user";

test("a thrown exec failure returns the full error, exit code, and captured output", async () => {
  const failure = Object.assign(new Error("Session sandbox-abc failed: container exited while running command because of an out-of-memory condition"), { exitCode: 137, stdout: "partial out", stderr: "Killed" });
  const result = await workspaceShellExec(async () => ({ shell: async () => { throw failure; } }), "make", {});
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

test("a command whose container was lost is flagged with a typed workspace_recycled signal", async () => {
  const lost = { shell: async () => ({ stdout: "", stderr: "lost", exitCode: -1, workspaceLost: true as const }) };
  const fine = { shell: async () => ({ stdout: "ok", stderr: "", exitCode: 0 }) };
  assert.equal((await workspaceShellExec(async () => lost, "ls", {})).workspace_recycled, true);
  assert.equal((await workspaceShellExec(async () => fine, "ls", {})).workspace_recycled, undefined);
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
  const workspace = { shell: async (cmd: string, opts: Record<string, unknown>) => { sent = { cmd, opts }; return { stdout: "", stderr: "", exitCode: 124 }; } };
  const result = await workspaceShellExec(async () => workspace, "echo 'it' && sleep 30", { timeout: 5000 });
  assert.equal(sent!.cmd, `timeout -k 2 5 bash -c 'echo '\\''it'\\'' && sleep 30'`);
  assert.ok((sent!.opts.timeout as number) > 5000, "the sandbox timeout must be looser than the shell timeout");
  assert.equal(result.exitCode, 124);
  assert.match(result.error ?? "", /timed out after 5000ms/);
});

test("a command that ends the shell is returned as its exit code", async () => {
  let calls = 0;
  const outcome = await execTreatingShellExitAsResult(async () => {
    calls += 1;
    throw new Error(`Session "sandbox-chat-x" ended because its shell exited (exit code: 2). Session-local state has been lost.`);
  });
  assert.equal(calls, 1);
  assert.equal((outcome as { exitCode: number }).exitCode, 2);
  assert.match((outcome as { stderr: string }).stderr, /files are unchanged/);
});

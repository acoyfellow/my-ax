import assert from "node:assert/strict";
import test from "node:test";
import { publicWorkspacePath, resolveWorkspacePath, listWorkspace, readWorkspace } from "./workspace-mcp";

test("resolveWorkspacePath aliases /workspace to /home/user", () => {
  assert.equal(resolveWorkspacePath("/workspace"), "/home/user");
  assert.equal(resolveWorkspacePath("/workspace/feature-requests/a.md"), "/home/user/feature-requests/a.md");
  assert.equal(resolveWorkspacePath("/home/user/feature-requests/a.md"), "/home/user/feature-requests/a.md");
});

test("resolveWorkspacePath rejects escape", () => {
  assert.throws(() => resolveWorkspacePath("/etc/passwd"), /must be inside/);
  assert.throws(() => resolveWorkspacePath("/home/user/../etc/passwd"), /must not contain/);
});

test("publicWorkspacePath maps back to /workspace", () => {
  assert.equal(publicWorkspacePath("/home/user"), "/workspace");
  assert.equal(publicWorkspacePath("/home/user/feature-requests/a.md"), "/workspace/feature-requests/a.md");
});

test("listWorkspace returns public paths and truncated", async () => {
  const sandbox = {
    exec: async () => ({
      exitCode: 0,
      stdout: "/home/user/feature-requests\n/home/user/feature-requests/session-hygiene-and-cleanup.md\n/home/user/extra\n",
    }),
  };
  const listed = await listWorkspace(sandbox, "/workspace", 2);
  assert.equal(listed.path, "/workspace");
  assert.equal(listed.truncated, true);
  assert.equal(listed.entries.length, 2);
  assert.equal(listed.entries[1]?.path, "/workspace/feature-requests/session-hygiene-and-cleanup.md");
});

test("readWorkspace truncates and maps the public path", async () => {
  const body = "hello world and more";
  const sandbox = {
    exec: async () => ({ exitCode: 0, stdout: body }),
  };
  const read = await readWorkspace(sandbox, "/workspace/feature-requests/a.md", 5);
  assert.equal(read.path, "/workspace/feature-requests/a.md");
  assert.equal(read.content, "hello");
  assert.equal(read.truncated, true);
});

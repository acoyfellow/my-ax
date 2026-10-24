import { test } from "node:test";
import assert from "node:assert/strict";
import { WORKSPACE_HOME, resolveWorkspacePath } from "./workspace-path";

test("relative paths resolve inside the workspace home, not the server cwd", () => {
  assert.equal(resolveWorkspacePath("notes/bugs.md"), `${WORKSPACE_HOME}/notes/bugs.md`);
  assert.equal(resolveWorkspacePath("./notes"), `${WORKSPACE_HOME}/notes`);
  assert.equal(resolveWorkspacePath("."), WORKSPACE_HOME);
  assert.equal(resolveWorkspacePath(""), WORKSPACE_HOME);
});

test("tilde paths resolve to the workspace home", () => {
  assert.equal(resolveWorkspacePath("~"), WORKSPACE_HOME);
  assert.equal(resolveWorkspacePath("~/a.txt"), `${WORKSPACE_HOME}/a.txt`);
});

test("absolute paths are kept", () => {
  assert.equal(resolveWorkspacePath("/root/x"), "/root/x");
});

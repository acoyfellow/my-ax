import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { workspaceInitCommand, WORKSPACE_ALIAS_PATH } from "./workspace-init";

function runInit(root: string) {
  const home = join(root, "home-user");
  const alias = join(root, "workspace");
  const marker = join(root, "ready");
  const command = workspaceInitCommand(home, marker).replaceAll(WORKSPACE_ALIAS_PATH, alias);
  execFileSync("sh", ["-c", command]);
  return { home, alias, marker };
}

test("a plain /workspace directory becomes a link to the durable home and keeps its files", () => {
  const root = mkdtempSync(join(tmpdir(), "ws-init-"));
  mkdirSync(join(root, "workspace", "notes"), { recursive: true });
  writeFileSync(join(root, "workspace", "notes", "pi.txt"), "kept");
  const { home, alias, marker } = runInit(root);
  assert.equal(lstatSync(alias).isSymbolicLink(), true);
  assert.equal(realpathSync(alias), realpathSync(home));
  assert.equal(readFileSync(join(home, "notes", "pi.txt"), "utf8"), "kept");
  assert.equal(existsSync(marker), true);
});

test("an existing durable file is never overwritten by the old /workspace copy", () => {
  const root = mkdtempSync(join(tmpdir(), "ws-init-"));
  mkdirSync(join(root, "home-user"), { recursive: true });
  writeFileSync(join(root, "home-user", "plan.md"), "durable");
  mkdirSync(join(root, "workspace"), { recursive: true });
  writeFileSync(join(root, "workspace", "plan.md"), "stale");
  const { home } = runInit(root);
  assert.equal(readFileSync(join(home, "plan.md"), "utf8"), "durable");
});

test("running init twice is a no-op", () => {
  const root = mkdtempSync(join(tmpdir(), "ws-init-"));
  runInit(root);
  const { home, alias } = runInit(root);
  assert.equal(realpathSync(alias), realpathSync(home));
});

test("a write through /workspace lands in the durable home", () => {
  const root = mkdtempSync(join(tmpdir(), "ws-init-"));
  const { home, alias } = runInit(root);
  writeFileSync(join(alias, "note.txt"), "through alias");
  assert.equal(readFileSync(join(home, "note.txt"), "utf8"), "through alias");
});

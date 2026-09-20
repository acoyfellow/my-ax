import assert from "node:assert/strict";
import test from "node:test";
import { shouldRestoreComputerSnapshot } from "./computer-id";
import { verifyWorkspaceRestore } from "./workspace-snapshot";

test("a live computer with a ready marker does not restore over current files", () => {
  assert.equal(shouldRestoreComputerSnapshot(undefined, 0), false);
  assert.equal(shouldRestoreComputerSnapshot(false, 1), false);
});

test("a recycled computer without a ready marker restores the stored snapshot", () => {
  assert.equal(shouldRestoreComputerSnapshot(undefined, 1), true);
  assert.equal(shouldRestoreComputerSnapshot(undefined, null), true);
});

test("restore receipt fails closed on a mismatched backup id", () => {
  assert.throws(
    () => verifyWorkspaceRestore(
      { backupId: "snap-1", backupDir: "/home/user" },
      { success: true, id: "other", dir: "/home/user" },
    ),
    /mismatch/,
  );
});

test("in-memory sleep wake: write, record snapshot, drop ready, restore same bytes", async () => {
  const files = new Map<string, string>();
  let ready = false;
  let backup: { id: string; dir: string } | null = null;
  const sandbox = {
    async writeFile(path: string, content: string) {
      files.set(path, content);
    },
    async readFile(path: string) {
      return { content: files.get(path) ?? "" };
    },
    async exec(cmd: string) {
      if (cmd.includes("test -f") && cmd.includes("ready")) return { exitCode: ready ? 0 : 1 };
      if (cmd.includes("rm -f") && cmd.includes("ready")) {
        ready = false;
        return { exitCode: 0 };
      }
      if (cmd.includes("mkdir")) {
        ready = true;
        return { exitCode: 0 };
      }
      return { exitCode: 0 };
    },
    async createBackup() {
      backup = { id: "b1", dir: "/home/user" };
      return backup;
    },
    async restoreBackup(input: { id: string; dir: string }) {
      if (!backup || input.id !== backup.id) return { success: false, id: input.id, dir: input.dir };
      return { success: true, id: backup.id, dir: backup.dir };
    },
  };
  const content = "hello-computer";
  await sandbox.writeFile("/home/user/.proof", content);
  const snap = await sandbox.createBackup();
  await sandbox.exec("rm -f /tmp/ready");
  assert.equal(shouldRestoreComputerSnapshot(undefined, (await sandbox.exec("test -f ready")).exitCode), true);
  const restored = await sandbox.restoreBackup(snap);
  verifyWorkspaceRestore({ backupId: snap.id, backupDir: snap.dir }, restored);
  await sandbox.exec("mkdir");
  const read = await sandbox.readFile("/home/user/.proof");
  assert.equal(read.content, content);
});

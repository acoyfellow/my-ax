import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REBUILDABLE_BACKUP_EXCLUDES,
  SANDBOX_ID_MAX_LENGTH,
  decideSnapshotPublish,
  homeLooksWiped,
  shouldRestoreDirectoryBackup,
  workspaceSandboxId,
  workspaceSnapshotKey,
} from "./workspace-policy";

test("owner scope keeps the existing per-owner sandbox id", () => {
  assert.equal(workspaceSandboxId("Owner@Example.com", { kind: "owner" }), "owner@example.com");
});

test("each chat gets its own sandbox id and snapshot key", () => {
  const a = workspaceSandboxId("owner@example.com", { kind: "chat", chatId: "AAA" });
  const b = workspaceSandboxId("owner@example.com", { kind: "chat", chatId: "bbb" });
  assert.notEqual(a, b);
  assert.notEqual(a, workspaceSandboxId("owner@example.com", { kind: "owner" }));
  assert.equal(workspaceSnapshotKey("owner@example.com", { kind: "chat", chatId: "AAA" }), "owner@example.com#chat:aaa");
});

test("chat sandbox ids fit the 63-character sandbox limit and stay distinct per owner", () => {
  const chatId = crypto.randomUUID();
  const longOwner = `${"a".repeat(40)}@${"b".repeat(40)}.example.com`;
  const id = workspaceSandboxId(longOwner, { kind: "chat", chatId });
  assert.ok(id.length <= SANDBOX_ID_MAX_LENGTH, id);
  assert.ok(!id.endsWith("-"));
  assert.match(id, /^chat-[0-9a-f]{16}-/);
  assert.notEqual(id, workspaceSandboxId("other@example.com", { kind: "chat", chatId }));
  assert.equal(id, workspaceSandboxId(longOwner.toUpperCase(), { kind: "chat", chatId }));
});

test("backups skip rebuildable dependency and build folders", () => {
  for (const pattern of ["node_modules", ".npm", ".next", "dist", ".venv", ".cache"]) {
    assert.ok(REBUILDABLE_BACKUP_EXCLUDES.includes(pattern as never), pattern);
  }
});

test("a near-empty backup never replaces a large one", () => {
  const large = 400 * 1024 * 1024;
  assert.deepEqual(decideSnapshotPublish(large, 4096), { publish: false, reason: "shrink_refused", previousBytes: large, nextBytes: 4096 });
  assert.deepEqual(decideSnapshotPublish(large, large / 2), { publish: true });
  assert.deepEqual(decideSnapshotPublish(null, 4096), { publish: true });
  assert.deepEqual(decideSnapshotPublish(1024 * 1024, 4096), { publish: true });
});

test("a disk boot with a healthy home keeps its disk instead of restoring an older home backup", () => {
  assert.equal(shouldRestoreDirectoryBackup({ restoredFromDiskSnapshot: "snap-1", homeBytes: 100_000_000, lastBackupBytes: 108_000_000 }), false);
});

test("a disk boot with an empty home restores the last good home backup", () => {
  assert.equal(shouldRestoreDirectoryBackup({ restoredFromDiskSnapshot: "snap-1", homeBytes: 15_716, lastBackupBytes: 107_945_388 }), true);
});

test("a plain image boot restores the latest home backup", () => {
  assert.equal(shouldRestoreDirectoryBackup({ restoredFromDiskSnapshot: null, homeBytes: null, lastBackupBytes: 107_945_388 }), true);
});

test("an empty home after a restore is reported as wiped, not ok", () => {
  assert.equal(homeLooksWiped(0, 107_945_388), true);
  assert.equal(homeLooksWiped(90_000_000, 107_945_388), false);
  assert.equal(homeLooksWiped(null, 107_945_388), false);
});

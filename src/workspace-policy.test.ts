import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REBUILDABLE_BACKUP_EXCLUDES,
  SANDBOX_ID_MAX_LENGTH,
  TURN_SNAPSHOT_COOLDOWN_MS,
  decideSnapshotPublish,
  turnSnapshotDue,
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

test("turn snapshots are rate-limited per workspace", () => {
  assert.equal(turnSnapshotDue(null, 0), true);
  assert.equal(turnSnapshotDue(1_000, 1_000 + TURN_SNAPSHOT_COOLDOWN_MS - 1), false);
  assert.equal(turnSnapshotDue(1_000, 1_000 + TURN_SNAPSHOT_COOLDOWN_MS), true);
});

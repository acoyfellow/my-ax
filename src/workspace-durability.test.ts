import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createWorkspaceSnapshotManifest,
  verifyWorkspaceRestore,
  type WorkspaceSnapshotPointer,
} from "./workspace-snapshot";

const checkpoint: WorkspaceSnapshotPointer = {
  id: "checkpoint-1",
  dir: "/home/user",
};

test("workspace checkpoint manifest and restore receipt round-trip deterministically", () => {
  const manifest = createWorkspaceSnapshotManifest(checkpoint);
  assert.deepEqual(manifest, { backupId: "checkpoint-1", backupDir: "/home/user" });

  const receipt = verifyWorkspaceRestore(manifest, {
    success: true,
    id: checkpoint.id,
    dir: checkpoint.dir,
  });

  assert.deepEqual(receipt, {
    backupId: "checkpoint-1",
    backupDir: "/home/user",
    restoredBackupId: "checkpoint-1",
    restoredBackupDir: "/home/user",
    verified: true,
  });
});

test("workspace restore receipt rejects missing and tampered checkpoint archives", () => {
  const manifest = createWorkspaceSnapshotManifest(checkpoint);

  for (const result of [
    { success: false, id: checkpoint.id, dir: checkpoint.dir },
    { success: true, id: "tampered-checkpoint", dir: checkpoint.dir },
    { success: true, id: checkpoint.id, dir: "/tmp" },
  ]) {
    assert.throws(() => verifyWorkspaceRestore(manifest, result), /Workspace restore receipt mismatch/);
  }
});

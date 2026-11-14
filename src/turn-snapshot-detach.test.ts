import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const pi = readFileSync(new URL("./pi-engine/pi-chat-agent.ts", import.meta.url), "utf8");

test("the compaction save runs detached so it never blocks the turn", () => {
  assert.match(pi, /compactionFinished\([^)]*\)\) this\.ctx\.waitUntil\(this\.keepAliveWhile\(\(\) => this\.saveWorkspaceAt\("compaction"\)\)\)/);
});

test("callbacks scheduled before the save-at-boundaries change still resolve to a method", () => {
  assert.match(pi, /async snapshotWorkspaceAfterTurn\(\)/);
  assert.match(pi, /async retryWorkspaceBackupAfterCooldown\(\)/);
});

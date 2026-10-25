import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("the compaction save runs detached so it never blocks the turn", () => {
  const pi = readFileSync(new URL("./pi-engine/pi-chat-agent.ts", import.meta.url), "utf8");
  const think = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");
  assert.match(pi, /compactionFinished\([^)]*\)\) this\.ctx\.waitUntil\(this\.keepAliveWhile\(\(\) => this\.saveWorkspaceAt\("compaction"\)\)\)/);
  assert.match(think, /if \(result\) this\.ctx\.waitUntil\(this\.saveWorkspaceAtCompaction\(\)\)/);
});

test("callbacks scheduled before the save-at-boundaries change still resolve to a method", () => {
  for (const path of ["./agent.ts", "./pi-engine/pi-chat-agent.ts"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /async snapshotWorkspaceAfterTurn\(\)/, path);
    assert.match(source, /async retryWorkspaceBackupAfterCooldown\(\)/, path);
  }
});

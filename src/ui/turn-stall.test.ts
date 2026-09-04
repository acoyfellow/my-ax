import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateTurnStall } from "./turn-stall";

test("a running tool is exempt from the stall watchdog", () => {
  assert.deepEqual(evaluateTurnStall({
    now: 100_000,
    composerLocked: true,
    socketOpen: true,
    alreadySurfaced: false,
    lastTurnFrameAt: 1,
    pendingTool: { name: "workspace.exec", startedAt: 2 },
    hasActiveRequest: true,
  }), {
    kind: "waiting-on-tool",
    toolName: "workspace.exec",
    elapsedMs: 99_998,
  });
});

test("Chat wires a genuine stall through cancellation and clears the remote lock", () => {
  const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");

  assert.match(chat, /hasActiveRequest: activeRequestId !== null/);
  assert.match(chat, /if \(verdict\.kind === "stalled"\) \{[\s\S]*?cancelAgent\(\);[\s\S]*?pushError\(stallMessage\(verdict\)/);
  assert.match(chat, /function cancelAgent\(\)[\s\S]*?remoteTurn = null;[\s\S]*?applyStatus\("idle"\);/);
});

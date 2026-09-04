import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTurnStall, stallFingerprint, stallMessage, TURN_STALL_MS } from "./turn-stall";

const base = {
  now: 100_000,
  composerLocked: true,
  socketOpen: true,
  alreadySurfaced: false,
  lastTurnFrameAt: 100_000 - (TURN_STALL_MS + 20_000),
  pendingTool: null,
};

test("a long-running tool is never called a stall", () => {
  const verdict = evaluateTurnStall({
    ...base,
    pendingTool: { name: "work_code", startedAt: base.now - 65_000 },
  });
  assert.equal(verdict.kind, "waiting-on-tool");
  assert.equal(verdict.kind === "waiting-on-tool" && verdict.toolName, "work_code");
});

test("a tool running far past the stall window still is not a stall", () => {
  const verdict = evaluateTurnStall({
    ...base,
    pendingTool: { name: "gh auth login", startedAt: base.now - 10 * 60_000 },
  });
  assert.equal(verdict.kind, "waiting-on-tool");
});

test("inactive turns stay quiet even when stale tool state remains", () => {
  const pendingTool = { name: "work_code", startedAt: base.now - 65_000 };
  assert.equal(evaluateTurnStall({ ...base, composerLocked: false, pendingTool }).kind, "quiet");
  assert.equal(evaluateTurnStall({ ...base, socketOpen: false, pendingTool }).kind, "quiet");
  assert.equal(evaluateTurnStall({ ...base, alreadySurfaced: true, pendingTool }).kind, "quiet");
});

test("silence with no tool running past the window is a stall", () => {
  const verdict = evaluateTurnStall(base);
  assert.equal(verdict.kind, "stalled");
});

test("silence inside the window is not yet a stall", () => {
  const verdict = evaluateTurnStall({ ...base, lastTurnFrameAt: base.now - 1_000 });
  assert.equal(verdict.kind, "quiet");
});

test("future timestamps do not produce negative elapsed durations", () => {
  const verdict = evaluateTurnStall({
    ...base,
    pendingTool: { name: "work_code", startedAt: base.now + 1_000 },
  });
  assert.deepEqual(verdict, { kind: "waiting-on-tool", toolName: "work_code", elapsedMs: 0 });
});

test("a stall reports the retry message and a stable fingerprint", () => {
  const verdict = evaluateTurnStall(base);
  assert.equal(verdict.kind, "stalled");
  if (verdict.kind !== "stalled") return;
  assert.equal(
    stallMessage(verdict),
    "No response from the agent, and no tool is running. The turn may have failed. Send another message to retry or steer.",
  );
  assert.equal(stallFingerprint(verdict), stallFingerprint(verdict));
  assert.match(stallFingerprint(verdict), /^turn-stall:/);
});

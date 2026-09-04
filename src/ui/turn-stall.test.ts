import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { evaluateTurnStall, stallFingerprint, stallMessage, TURN_STALL_MS } from "./turn-stall";

const base = {
  now: 100_000,
  composerLocked: true,
  socketOpen: true,
  alreadySurfaced: false,
  requestActive: true,
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

test("silence with no tool running past the window is a stall", () => {
  const verdict = evaluateTurnStall(base);
  assert.equal(verdict.kind, "stalled");
});

test("silence inside the window is not yet a stall", () => {
  const verdict = evaluateTurnStall({ ...base, lastTurnFrameAt: base.now - 1_000 });
  assert.equal(verdict.kind, "quiet");
});

test("an unlocked composer, inactive request, closed socket, or surfaced stall stays quiet", () => {
  assert.equal(evaluateTurnStall({ ...base, composerLocked: false }).kind, "quiet");
  assert.equal(evaluateTurnStall({ ...base, requestActive: false }).kind, "quiet");
  assert.equal(evaluateTurnStall({ ...base, socketOpen: false }).kind, "quiet");
  assert.equal(evaluateTurnStall({ ...base, alreadySurfaced: true }).kind, "quiet");
});

test("a stall reports elapsed time and a stable fingerprint", () => {
  const verdict = evaluateTurnStall(base);
  assert.equal(verdict.kind, "stalled");
  if (verdict.kind !== "stalled") return;
  assert.equal(stallMessage(verdict), "No response from the agent, and no tool is running. The turn may have failed. Send another message to retry or steer.");
  assert.equal(stallFingerprint(verdict), stallFingerprint(verdict));
  assert.match(stallFingerprint(verdict), /^turn-stall:/);
});

function watchdogBlock(): string {
  const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");
  const call = chat.indexOf("const verdict = evaluateTurnStall({");
  assert.ok(call > 0, "Chat must call the shared stall evaluator inside the watchdog");
  return chat.slice(call, call + 900);
}

test("the watchdog does not fake a done frame; a live turn must not be marked finished", () => {
  assert.doesNotMatch(watchdogBlock(), /done:\s*true/,
    "synthesizing a done frame ends a turn that is still running");
});

test("a genuine stall is reported as an error, not a system aside", () => {
  const block = watchdogBlock();
  assert.match(block, /pushError\(stallMessage/, "a stall is a failure and must be reported as one");
  assert.doesNotMatch(block, /pushSystem/, "a failed turn must not be a neutral aside");
});

test("the wired Chat watchdog cancels only a stalled active request through the normal cancellation path", () => {
  const block = watchdogBlock();
  assert.match(block, /pendingTool:\s*firstPendingTool\(\)/,
    "without the pending-tool input the evaluator cannot tell work from silence");
  assert.match(block, /requestActive:\s*!!activeRequestId/,
    "a remote composer lock alone is not a cancellable request");
  assert.match(block, /if \(verdict\.kind === "stalled"\) \{\s*cancelAgent\(\);/,
    "Chat must retire a genuine stall through its existing cancellation path");
});

test("Chat cancellation invalidates old remote turn state before unlocking the composer", () => {
  const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");
  const start = chat.indexOf("function cancelAgent()");
  assert.ok(start > 0, "Chat must expose the shared cancellation path");
  const block = chat.slice(start, start + 1_500);
  assert.match(block, /cf_agent_chat_request_cancel/);
  assert.match(block, /remoteTurnEpoch \+= 1;/);
  assert.match(block, /remoteTurn = null;/);
  assert.match(block, /applyStatus\("idle"\)/);
});

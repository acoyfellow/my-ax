import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");

test("Chat wires a no-tool stall to the existing cancellation path", () => {
  const watchdog = chat.slice(
    chat.indexOf("const verdict = evaluateTurnStall({"),
    chat.indexOf("}, 5_000);", chat.indexOf("const verdict = evaluateTurnStall({")),
  );
  assert.match(watchdog, /pendingTool:\s*firstPendingTool\(\)/);
  assert.match(watchdog, /if \(verdict\.kind === "stalled"\)/);
  assert.match(watchdog, /pushError\(stallMessage\(verdict\)/);
  assert.match(watchdog, /cancelAgent\(\)/);
});

test("Chat cancellation unlocks local and remote turn locks for recovery", () => {
  const start = chat.indexOf("function cancelAgent() {");
  const end = chat.indexOf("\n  // Global Esc", start);
  const cancellation = chat.slice(start, end);
  assert.match(cancellation, /cf_agent_chat_request_cancel/);
  assert.match(cancellation, /remoteTurn = null/);
  assert.match(cancellation, /activeRequestId = null/);
  assert.match(cancellation, /applyStatus\("idle"\)/);
});

test("Chat keeps the text composer available when voice mode is off", () => {
  assert.ok(chat.includes("{#if !voiceEnabled}\n              <textarea"));
});

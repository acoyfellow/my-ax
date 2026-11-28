import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("the Pi chat harness factory passes onWake so sleeping tasks wake by alarm, not by in-memory timers", () => {
  const source = readFileSync(new URL("./pi-chat-agent.ts", import.meta.url), "utf8");
  assert.match(source, /harness: \(\{ storage, context, onWake \}\)/);
  // The options object holds nested braces (settings, telemetry), so check the whole Harness.open(...) call, not a brace-free span.
  const open = source.match(/Harness\.open\(storage, \{[^\n]*\}, context\)/);
  assert.ok(open, "Harness.open(storage, {...}, context) call not found");
  assert.match(open[0], /[{,]\s*onWake\s*[,}]/);
});

test("the Pi chat socket does not send the owner-scoped instance name to clients", async () => {
  const { PiChatAgent } = await import("./pi-chat-agent");
  assert.equal((PiChatAgent as unknown as { options?: { sendIdentityOnConnect?: boolean } }).options?.sendIdentityOnConnect, false);
});

test("the voice socket does not send the owner-scoped instance name to clients", async () => {
  const { VoiceThinkAgent } = await import("../voice-think-agent");
  assert.equal((VoiceThinkAgent as unknown as { options?: { sendIdentityOnConnect?: boolean } }).options?.sendIdentityOnConnect, false);
});

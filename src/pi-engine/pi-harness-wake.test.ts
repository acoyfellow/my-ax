import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("the Pi chat harness factory passes onWake so sleeping tasks wake by alarm, not by in-memory timers", () => {
  const source = readFileSync(new URL("./pi-chat-agent.ts", import.meta.url), "utf8");
  assert.match(source, /harness: \(\{ storage, context, onWake \}\)/);
  assert.match(source, /Harness\.open\(storage, \{[^}]*\bonWake\b[^}]*\}, context\)/);
});

test("the Pi chat socket does not send the owner-scoped instance name to clients", async () => {
  const { PiChatAgent } = await import("./pi-chat-agent");
  assert.equal((PiChatAgent as unknown as { options?: { sendIdentityOnConnect?: boolean } }).options?.sendIdentityOnConnect, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { parseVoiceThinkAgentName, resolveVoiceThinkConfig } from "./voice-think-config";

const seeded = { identity: { email: "seeded@example.com", sub: "seeded-sub" }, sessionId: "seeded-session" };

test("voice think config keeps explicitly seeded identity/session", () => {
  assert.deepEqual(resolveVoiceThinkConfig(seeded, "owner@example.com:session-1"), seeded);
});

test("voice think config recovers owner/session from direct actor name", () => {
  assert.deepEqual(parseVoiceThinkAgentName("Owner@Example.com:session-1"), {
    identity: { email: "owner@example.com", sub: "owner@example.com" },
    sessionId: "session-1",
  });
  assert.deepEqual(resolveVoiceThinkConfig({}, "Owner@Example.com:session-1"), {
    identity: { email: "owner@example.com", sub: "owner@example.com" },
    sessionId: "session-1",
  });
});

test("voice think config fails closed when neither state nor actor name link a session", () => {
  assert.equal(parseVoiceThinkAgentName("session-1"), null);
  assert.equal(parseVoiceThinkAgentName("owner@example.com:"), null);
  assert.equal(parseVoiceThinkAgentName(":session-1"), null);
  assert.deepEqual(resolveVoiceThinkConfig({}, "session-1"), {});
});

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

// Regression: the voice route must route with the RAW voiceName. Percent-
// encoding it sent the socket to a different (unseeded) DO whose this.name was
// "email%3Asession" — no literal ':' — so the name-parse fallback returned {}
// and every turn answered "Voice session is not linked to a conversation yet."
test("voice actor name must round-trip through the router without percent-encoding", () => {
  const voiceName = "owner@example.com:11111111-2222-4333-8444-555555555555";

  // The OLD broken behavior: encodeURIComponent(voiceName) as the path segment.
  const encoded = encodeURIComponent(voiceName);
  assert.equal(parseVoiceThinkAgentName(encoded), null, "percent-encoded name must NOT parse (this was the bug)");
  assert.deepEqual(resolveVoiceThinkConfig({}, encoded), {}, "percent-encoded name yields an unlinked config");

  // The FIX: the raw voiceName travels through URL.pathname unchanged, so the
  // routed DO name equals the seeded voiceName and the fallback also parses.
  const routedSegment = new URL(`https://h/agents/voice-think-agent/${voiceName}`)
    .pathname.split("/").filter(Boolean)[2];
  assert.equal(routedSegment, voiceName, "raw voiceName must survive URL.pathname unchanged");
  assert.deepEqual(parseVoiceThinkAgentName(routedSegment), {
    identity: { email: "owner@example.com", sub: "owner@example.com" },
    sessionId: "11111111-2222-4333-8444-555555555555",
  });
});

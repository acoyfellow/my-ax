import assert from "node:assert/strict";
import test from "node:test";
import { deadSessionIncident, deadSessionRecoveryPlan, detectDeadSession, isAutoRevive, isDeadSessionAttentionForCurrentTurn } from "./dead-session-detector";

const now = new Date("2026-06-23T12:00:00.000Z");
const stale = "2026-06-23T11:54:59.000Z";

test("dead when stale turn ends on a tool without an assistant reply", () => {
  assert.deepEqual(detectDeadSession([
    { id: 1, role: "assistant", content: "Earlier reply" },
    { id: 2, role: "user", content: "Please finish this" },
    { id: 3, role: "tool", content: "partial result" },
  ], stale, now), { latestUserEntryId: 2, latestUserMessage: "Please finish this" });
});

test("alive when the latest entry is assistant", () => {
  assert.equal(detectDeadSession([
    { id: 1, role: "user", content: "Question" },
    { id: 2, role: "assistant", content: "Answer" },
  ], stale, now), null);
});

test("alive while updated_at is within the stall threshold", () => {
  assert.equal(detectDeadSession([
    { id: 1, role: "user", content: "Question" },
    { id: 2, role: "tool", content: "Working" },
  ], "2026-06-23T11:58:00.000Z", now), null);
});

test("alive when the most recent user already has a later assistant entry", () => {
  assert.equal(detectDeadSession([
    { id: 1, role: "user", content: "Question" },
    { id: 2, role: "assistant", content: "Answer" },
    { id: 3, role: "tool", content: "Late log line" },
  ], stale, now), null);
});

test("automatic revival stays attached to the original dead-turn incident", () => {
  const retry = { id: 9, role: "user", content: "x", meta_json: JSON.stringify({ uiMessageId: "auto-revive:42" }) };
  assert.deepEqual(deadSessionIncident(retry), { alreadyRevived: true, originalUserEntryId: 42 });
  assert.deepEqual(deadSessionRecoveryPlan(retry), { alreadyRevived: true, originalUserEntryId: 42, action: "notify_owner" });
  assert.deepEqual(deadSessionRecoveryPlan({ id: 41, role: "user", content: "x", meta_json: null }), { alreadyRevived: false, originalUserEntryId: 41, action: "retry_silently" });
  assert.equal(isAutoRevive(retry), true);
  assert.deepEqual(deadSessionIncident({ id: 9, role: "user", content: "x", meta_json: JSON.stringify({ uiMessageId: "ui-123" }) }), { alreadyRevived: false, originalUserEntryId: 9 });
  assert.deepEqual(deadSessionIncident({ id: 9, role: "user", content: "x", meta_json: JSON.stringify({ uiMessageId: "auto-revive:not-an-id" }) }), { alreadyRevived: true, originalUserEntryId: 9 });
  assert.equal(isAutoRevive({ id: 9, role: "user", content: "x", meta_json: null }), false);
  assert.equal(isAutoRevive(undefined), false);
});

test("dead-session attention dedupes only the current unanswered user turn", () => {
  assert.equal(isDeadSessionAttentionForCurrentTurn("2026-06-23T12:00:00.000Z", "2026-06-23T11:59:00.000Z"), true);
  assert.equal(isDeadSessionAttentionForCurrentTurn("2026-06-23T11:58:00.000Z", "2026-06-23T11:59:00.000Z"), false);
  assert.equal(isDeadSessionAttentionForCurrentTurn(null, "2026-06-23T11:59:00.000Z"), false);
  assert.equal(isDeadSessionAttentionForCurrentTurn("not-a-date", "2026-06-23T11:59:00.000Z"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { d1EntriesToTranscriptMessages } from "./d1-transcript";
import { boundToSession, keepDurableTurn, mergeTranscript, type MergeableMessage } from "./transcript-merge";

const sessionId = "conversation-a";
const renderMarkdown = (text: string) => text;
const entries = [
  { id: "1", role: "user", content: "Run the task", meta: { uiMessageId: "user-1" } },
  { id: "2", role: "assistant", content: "Illegal invocation: incorrect this reference", meta: { uiMessageId: "failure-1" } },
  { id: "3", role: "error", content: "Request failed" },
];

test("every restored row belongs to the conversation, never its array position", () => {
  const restored = d1EntriesToTranscriptMessages(entries, { sessionId, renderMarkdown });
  assert.deepEqual(restored.map((m) => m.sessionId), [sessionId, sessionId, sessionId]);
  assert.deepEqual(boundToSession(restored, sessionId).map((m) => m.id), ["user-1", "failure-1", "d1-3"]);
});

test("stored assistant failures and error rows survive a replay that omits them", () => {
  const restored = d1EntriesToTranscriptMessages(entries, { sessionId, renderMarkdown });
  const replay = [restored[0]!];
  let visible = restored;
  for (let repeat = 0; repeat < 3; repeat++) {
    visible = boundToSession(mergeTranscript(visible, replay, { keepExistingOnlyIf: keepDurableTurn }), sessionId);
    assert.deepEqual(visible.map((m) => m.content), entries.map((e) => e.content));
  }
  assert.deepEqual(boundToSession(visible, "conversation-b"), []);
});

test("replay collapses only a tool receipt whose call is represented inline", () => {
  const restored = d1EntriesToTranscriptMessages([
    { id: "4", role: "tool", tool: "run", content: "ok", meta: { toolCallId: "call-1" } },
    { id: "5", role: "tool", tool: "run", content: "failed", isError: true, meta: { toolCallId: "call-2" } },
  ], { sessionId, renderMarkdown });
  const incoming = { ...restored[0]!, id: "assistant", durableToolCallId: undefined };
  const merged = mergeTranscript<MergeableMessage>(restored, [incoming]);
  assert.equal(merged.some((m) => m.id === "d1-4"), false);
  assert.equal(merged.some((m) => m.id === "d1-5"), true);
  assert.equal(merged.some((m) => m.id === "assistant"), true);
});

test("a replay tool placeholder cannot erase a stored tool failure", () => {
  const restored = d1EntriesToTranscriptMessages([
    { id: "6", role: "tool", tool: "run", content: "Access denied", isError: true, meta: { toolCallId: "failed-call" } },
  ], { sessionId, renderMarkdown });
  const replay: MergeableMessage = {
    id: "assistant", role: "assistant", sessionId,
    parts: [{ kind: "tool", tool: { id: "failed-call", state: "pending", result: undefined, isError: false } }],
  };
  const merged = mergeTranscript<MergeableMessage>(restored, [replay]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0]?.parts, [{ kind: "tool", tool: { id: "failed-call", state: "error", result: "Access denied", isError: true } }]);
});

test("late durable restoration merges instead of replacing the replay", () => {
  const restored = d1EntriesToTranscriptMessages(entries, { sessionId, renderMarkdown });
  const live = { ...restored[0]!, id: "new-reply", content: "Latest response" };
  const visible = mergeTranscript([live], restored, { preferIncoming: false });
  assert.equal(visible.some((m) => m.id === "new-reply"), true);
  assert.equal(visible.some((m) => m.id === "failure-1"), true);
});

test("older pages retain durable failures with synthetic row ids", () => {
  const older = d1EntriesToTranscriptMessages([entries[2]!], { sessionId, renderMarkdown });
  assert.equal(keepDurableTurn(older[0]!), true);
  assert.deepEqual(mergeTranscript(older, older).map((m) => m.id), ["d1-3"]);
});

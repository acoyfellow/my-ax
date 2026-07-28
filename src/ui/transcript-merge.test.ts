import assert from "node:assert/strict";
import test from "node:test";
import { mergeTranscript } from "./transcript-merge";

const msg = (
  id: string,
  role: string,
  timestamp?: number,
  extra: Record<string, unknown> = {},
): { id: string; role: string; timestamp?: number; content?: string; [k: string]: unknown } =>
  ({ id, role, timestamp, ...extra });

// #1/#3 regression: the D1 REST read and the server Think replay now key the SAME
// row identically (meta.uiMessageId || d1-<id>). Merging them must dedup, and
// repeating the merge (every cf_agent_chat_messages replay) must be idempotent —
// never growing the transcript or duplicating a message.
test("merge of identically-keyed D1 + Think replay dedups (no duplication)", () => {
  const d1 = [msg("ui-1", "user", 1), msg("ui-2", "assistant", 2), msg("ui-3", "user", 3)];
  const think = [msg("ui-1", "user", 1), msg("ui-2", "assistant", 2), msg("ui-3", "user", 3)];
  const merged = mergeTranscript(d1, think);
  assert.equal(merged.length, 3);
  assert.equal(new Set(merged.map((m) => m.id)).size, 3);
});

test("merge is idempotent under repeated Think replays", () => {
  const d1 = [msg("ui-1", "user", 1), msg("ui-2", "assistant", 2)];
  const think = [msg("ui-1", "user", 1), msg("ui-2", "assistant", 2)];
  let m = mergeTranscript(d1, think);
  for (let i = 0; i < 5; i++) m = mergeTranscript(m, think);
  assert.equal(m.length, 2, "repeated replays must not grow the transcript");
  assert.deepEqual(m.map((x) => x.id), ["ui-1", "ui-2"]);
});

// THE bug: D1 restored an assistant reply; Think's compacted replay omits it.
test("keeps a D1-only assistant reply that Think's replay omitted", () => {
  const d1 = [msg("u1", "user", 1), msg("a1", "assistant", 2), msg("u2", "user", 3), msg("a2", "assistant", 4)];
  const think = [msg("u1", "user", 1), msg("u2", "user", 3), msg("a2", "assistant", 4)]; // a1 compacted away
  const merged = mergeTranscript(d1, think);
  assert.deepEqual(merged.map((m) => m.id), ["u1", "a1", "u2", "a2"]);
  assert.ok(merged.find((m) => m.id === "a1"), "the assistant reply must survive");
});

test("Think's version wins for a message present in both (authoritative content)", () => {
  const d1 = [msg("a1", "assistant", 2, { content: "d1 partial" })];
  const think = [msg("a1", "assistant", 2, { content: "think full" })];
  const merged = mergeTranscript(d1, think);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].content, "think full");
});

test("empty Think replay keeps the full D1 transcript", () => {
  const d1 = [msg("u1", "user", 1), msg("a1", "assistant", 2)];
  const merged = mergeTranscript(d1, []);
  assert.deepEqual(merged.map((m) => m.id), ["u1", "a1"]);
});

test("adds Think-only messages not yet in D1", () => {
  const d1 = [msg("u1", "user", 1)];
  const think = [msg("u1", "user", 1), msg("a1", "assistant", 2)];
  const merged = mergeTranscript(d1, think);
  assert.deepEqual(merged.map((m) => m.id), ["u1", "a1"]);
});

test("orders by timestamp ascending across both sources", () => {
  const d1 = [msg("a2", "assistant", 40), msg("a1", "assistant", 20)];
  const think = [msg("u1", "user", 10), msg("u2", "user", 30)];
  const merged = mergeTranscript(d1, think);
  assert.deepEqual(merged.map((m) => m.id), ["u1", "a1", "u2", "a2"]);
});

test("stable first-seen order for equal/absent timestamps", () => {
  const d1 = [msg("x", "user"), msg("y", "assistant")];
  const think = [msg("z", "user")];
  const merged = mergeTranscript(d1, think);
  assert.deepEqual(merged.map((m) => m.id), ["x", "y", "z"]);
});

test("preferIncoming=false keeps existing on collision (defensive option)", () => {
  const d1 = [msg("a1", "assistant", 2, { content: "keep me" })];
  const think = [msg("a1", "assistant", 2, { content: "discard" })];
  const merged = mergeTranscript(d1, think, { preferIncoming: false });
  assert.equal(merged[0].content, "keep me");
});

test("keepExistingOnlyIf drops D1-only synthetic tool rows but keeps real turns", () => {
  // D1 restored: a real assistant turn (a1) + a synthetic tool row (d1-9).
  // Think's replay omits both (compacted) but will re-render the tool inline.
  const d1 = [msg("u1", "user", 1), msg("a1", "assistant", 2), msg("d1-9", "system", 3)];
  const think = [msg("u1", "user", 1)];
  const merged = mergeTranscript(d1, think, { keepExistingOnlyIf: (m) => !m.id.startsWith("d1-") });
  assert.deepEqual(merged.map((m) => m.id), ["u1", "a1"]);
  assert.ok(!merged.find((m) => m.id === "d1-9"), "synthetic tool row must be dropped");
});

test("keepExistingOnlyIf still keeps a d1- row if Think ALSO has that id (collision path)", () => {
  // Defensive: if the same id appears on both sides, it's not existing-only, so the
  // predicate does not apply and the incoming (Think) version is used.
  const d1 = [msg("d1-9", "system", 3, { content: "d1" })];
  const think = [msg("d1-9", "assistant", 3, { content: "think" })];
  const merged = mergeTranscript(d1, think, { keepExistingOnlyIf: (m) => !m.id.startsWith("d1-") });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].content, "think");
});

test("no duplicate ids in output when both sides share ids", () => {
  const d1 = [msg("u1", "user", 1), msg("a1", "assistant", 2)];
  const think = [msg("u1", "user", 1), msg("a1", "assistant", 2)];
  const merged = mergeTranscript(d1, think);
  assert.equal(merged.length, 2);
  assert.equal(new Set(merged.map((m) => m.id)).size, 2);
});

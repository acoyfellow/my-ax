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

test("no duplicate ids in output when both sides share ids", () => {
  const d1 = [msg("u1", "user", 1), msg("a1", "assistant", 2)];
  const think = [msg("u1", "user", 1), msg("a1", "assistant", 2)];
  const merged = mergeTranscript(d1, think);
  assert.equal(merged.length, 2);
  assert.equal(new Set(merged.map((m) => m.id)).size, 2);
});

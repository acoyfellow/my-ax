import assert from "node:assert/strict";
import { test } from "node:test";
import { SLIM_TEXT_LIMIT, slimEntries, slimEntry } from "./slim-entries";

const long = "x".repeat(SLIM_TEXT_LIMIT * 3);

test("long tool output is clipped and the entry is marked clipped", () => {
  const entry = slimEntry({ id: 1, kind: "pi.tool", model: [{ role: "toolResult", toolCallId: "a", content: [{ type: "text", text: long }] }] });
  const block = (entry.model![0].content as Array<{ text: string }>)[0];
  assert.equal(block.text.length, SLIM_TEXT_LIMIT);
  assert.equal(entry.clipped, true);
});

test("thinking keeps its text but loses the signature", () => {
  const entry = slimEntry({ id: 2, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "thinking", thinking: "hmm", thinkingSignature: long }] }] });
  assert.deepEqual(entry.model![0].content, [{ type: "thinking", thinking: "hmm" }]);
  assert.equal(entry.clipped, undefined);
});

test("long tool call arguments are clipped", () => {
  const entry = slimEntry({ id: 3, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "toolCall", id: "a", name: "write", arguments: { path: "a.ts", content: long } }] }] });
  const args = (entry.model![0].content as Array<{ arguments: { path: string; content: string } }>)[0].arguments;
  assert.equal(args.path, "a.ts");
  assert.equal(args.content.length, SLIM_TEXT_LIMIT);
  assert.equal(entry.clipped, true);
});

test("inline image data is dropped", () => {
  const entry = slimEntry({ id: 4, kind: "pi.user", model: [{ role: "user", content: [{ type: "text", text: "see" }, { type: "image", data: long, mimeType: "image/png" }] }] });
  assert.deepEqual((entry.model![0].content as unknown[])[1], { type: "image", mimeType: "image/png", omitted: true });
  assert.equal(entry.clipped, true);
});

test("assistant and user text is never clipped", () => {
  const entry = slimEntry({ id: 5, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: long }] }] });
  assert.equal((entry.model![0].content as Array<{ text: string }>)[0].text, long);
});

test("only the newest window of entries is sent, with the older count", () => {
  const entries = Array.from({ length: 10 }, (_, id) => ({ id, kind: "pi.user", model: [] }));
  const result = slimEntries(entries, 4);
  assert.deepEqual(result.entries.map((entry) => entry.id), [6, 7, 8, 9]);
  assert.equal(result.olderCount, 6);
});

test("bulky metadata the page never reads is dropped", () => {
  const entry = slimEntry({ id: 6, kind: "pi.assistant", conversationId: "c", model: [{ role: "assistant", content: [], usage: { input: 1 }, diagnostics: [long], stopReason: "stop", timestamp: 5 }] });
  assert.deepEqual(entry, { id: 6, kind: "pi.assistant", model: [{ role: "assistant", stopReason: "stop", timestamp: 5, content: [] }] });
});

test("JSON tool output stays valid JSON so widgets still render", () => {
  const output = JSON.stringify({ kind: "svelte-artifact", id: "w1", log: long, src: "data:image/png;base64," + long });
  const entry = slimEntry({ id: 7, kind: "pi.tool", model: [{ role: "toolResult", content: [{ type: "text", text: output }] }] });
  const parsed = JSON.parse((entry.model![0].content as Array<{ text: string }>)[0].text);
  assert.equal(parsed.kind, "svelte-artifact");
  assert.equal(parsed.log.length, SLIM_TEXT_LIMIT);
  assert.equal(parsed.src.length, output.length - JSON.stringify({ kind: "svelte-artifact", id: "w1", log: long, src: "" }).length);
  assert.equal(entry.clipped, true);
});

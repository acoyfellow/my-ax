import assert from "node:assert/strict";
import test from "node:test";
import { d1EntryToTranscriptMessage } from "./d1-transcript";

test("D1 reload keeps a validated show_diff receipt as a typed tool result", () => {
  const message = d1EntryToTranscriptMessage({
    id: 42,
    role: "tool",
    tool: "show_diff",
    isError: false,
    content: JSON.stringify({
      kind: "code-diff",
      version: 1,
      path: "src/example.ts",
      title: "Example update",
      oldText: "export const answer = 41;\n",
      newText: "export const answer = 42;\n",
      source: { old: "workspace", new: "machine" },
    }),
    createdAt: "2026-08-05T00:00:00.000Z",
    meta: { args: { path: "src/example.ts" } },
  }, (text) => text);

  assert.equal(message.role, "assistant");
  assert.equal(message.parts[0].kind, "tool");
  if (message.parts[0].kind !== "tool") throw new Error("missing tool result");
  assert.deepEqual(message.parts[0].tool.arguments, { path: "src/example.ts" });
  assert.equal((message.parts[0].tool.result as { kind?: string }).kind, "code-diff");
  assert.equal((message.parts[0].tool.result as { newText?: string }).newText, "export const answer = 42;\n");
});

test("D1 reload retains malformed show_diff output as an inert raw result", () => {
  const raw = "{not valid JSON";
  const message = d1EntryToTranscriptMessage({
    id: 43,
    role: "tool",
    tool: "show_diff",
    content: raw,
    createdAt: "2026-08-05T00:00:00.000Z",
  }, (text) => text);

  assert.equal(message.parts[0].kind, "tool");
  if (message.parts[0].kind !== "tool") throw new Error("missing tool result");
  assert.equal(message.parts[0].tool.result, raw);
  assert.equal(message.parts[0].tool.name, "show_diff");
});

test("a D1 row without createdAt does not pretend it was just sent", () => {
  const before = Date.now();
  const message = d1EntryToTranscriptMessage({
    id: 99,
    role: "user",
    content: "old turn",
  }, (text) => text);
  assert.equal(message.timestamp, undefined);
  assert.ok(before);
});

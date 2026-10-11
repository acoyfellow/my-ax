import assert from "node:assert/strict";
import { test } from "node:test";
import { indexRowsFor } from "./conversation-index";

test("new-engine entries become searchable user, assistant and tool rows, once each", () => {
  const entries = [
    { id: 1, kind: "pi.user", model: [{ role: "user", content: "find the tardigrade chat" }] },
    { id: 2, kind: "pi.run-start" },
    { id: 3, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "thinking", text: "hmm" }, { type: "toolCall", name: "exec" }] }] },
    { id: 4, kind: "pi.tool-result", model: [{ role: "toolResult", toolName: "exec", isError: true, content: [{ type: "text", text: "exit 1" }] }] },
    { id: 5, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "Found it." }] }] },
  ];
  assert.deepEqual(indexRowsFor(entries, 0).map((row) => [row.piEntryId, row.role, row.tool, row.isError, row.content]), [
    [1, "user", null, false, "find the tardigrade chat"],
    [3, "assistant", null, false, "[called exec]"],
    [4, "tool", "exec", true, "exit 1"],
    [5, "assistant", null, false, "Found it."],
  ]);
  assert.deepEqual(indexRowsFor(entries, 3).map((row) => row.piEntryId), [4, 5]);
});

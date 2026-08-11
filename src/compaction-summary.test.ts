import { expect, test } from "vitest";
import { ownerVisibleTranscript } from "./compaction-summary";

test("compaction summaries stay in model context but leave the owner transcript", () => {
  const compactionSummary = {
    id: "compaction_123",
    role: "assistant",
    text: "The conversation history before this point was compacted into the following summary.",
  };
  const modelContext = [compactionSummary, { id: "a1", role: "assistant", text: "Current reply" }];

  const ownerTranscript = ownerVisibleTranscript(modelContext);

  expect(ownerTranscript.map((message) => message.id)).toEqual(["a1"]);
  expect(modelContext[0]).toBe(compactionSummary);
  expect(modelContext[0].text).toBe("The conversation history before this point was compacted into the following summary.");
});

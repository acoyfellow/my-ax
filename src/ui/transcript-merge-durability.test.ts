import assert from "node:assert/strict";
import test from "node:test";
import { pageConversationEntries, type ConversationEntryRow } from "../session-entries";
import { d1EntriesToTranscriptMessages } from "./d1-transcript";
import { mergeTranscript } from "./transcript-merge";

const LONG_REASONING = "The owner wants a plan for every platform. ".repeat(400);

function storedRow(id: number, uiMessageId: string, content: string, metaJson: string): ConversationEntryRow {
  return { id, ts: `2026-09-30T08:0${id % 10}:00.000Z`, role: "assistant", tool: null, is_error: 0, content, meta_json: metaJson };
}

function restoredIds(rows: ConversationEntryRow[]) {
  const { entries } = pageConversationEntries(rows, 200, 0);
  return d1EntriesToTranscriptMessages(entries, { sessionId: "session-1", renderMarkdown: (text) => text });
}

test("a stored reply with long reasoning restores under its live message id", () => {
  const meta = JSON.stringify({ uiMessageId: "reply-1", reasoning: LONG_REASONING });
  const [restored] = restoredIds([storedRow(1, "reply-1", "This is a meaty one.", meta)]);
  assert.equal(restored?.id, "reply-1");
});

test("the restored copy and the live copy of one reply merge into one message", () => {
  const meta = JSON.stringify({ uiMessageId: "reply-1", reasoning: LONG_REASONING });
  const restored = restoredIds([storedRow(1, "reply-1", "This is a meaty one.", meta)]);
  const live = [{ id: "reply-1", role: "assistant", content: "This is a meaty one.", timestamp: Date.parse("2026-09-30T08:01:00.000Z"), sessionId: "session-1", parts: restored[0]?.parts ?? [], streaming: false, pending: false }];
  const merged = mergeTranscript(restored, live);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, "reply-1");
});

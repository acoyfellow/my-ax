import assert from "node:assert/strict";
import test from "node:test";
import {
  clampEntriesLimit,
  parseEntriesBeforeCursor,
  pageConversationEntriesDesc,
  type ConversationEntryRow,
} from "./session-entries";

const row = (id: number, role = "user"): ConversationEntryRow => ({
  id, ts: new Date(1_700_000_000_000 + id * 1000).toISOString(), role, tool: null, is_error: 0,
  content: `m${id}`, meta_json: JSON.stringify({ uiMessageId: `ui-${id}` }),
});

// Rows come from `id < before ORDER BY id DESC LIMIT limit+1` — newest first.
test("desc page returns chronological order for render", () => {
  const rows = [row(50), row(49), row(48)]; // DESC from D1
  const page = pageConversationEntriesDesc(rows, 10);
  assert.deepEqual(page.entries.map((e) => e.id), ["48", "49", "50"]);
  assert.equal(page.hasOlder, false);
  assert.equal(page.olderCursor, "48");
});

test("desc page caps at limit and flags older history via the extra row", () => {
  const rows = [row(50), row(49), row(48), row(47)]; // 4 rows, limit 3 => hasOlder
  const page = pageConversationEntriesDesc(rows, 3);
  assert.equal(page.entries.length, 3);
  assert.deepEqual(page.entries.map((e) => e.id), ["48", "49", "50"]); // newest 3, chronological
  assert.equal(page.hasOlder, true);
  assert.equal(page.olderCursor, "48"); // page further back with before=48
});

test("empty session yields no entries, no older cursor", () => {
  const page = pageConversationEntriesDesc([], 50);
  assert.deepEqual(page.entries, []);
  assert.equal(page.hasOlder, false);
  assert.equal(page.olderCursor, null);
});

test("before cursor: absent => newest (MAX), digits ok, junk rejected", () => {
  assert.equal(parseEntriesBeforeCursor(undefined), Number.MAX_SAFE_INTEGER);
  assert.equal(parseEntriesBeforeCursor(""), Number.MAX_SAFE_INTEGER);
  assert.equal(parseEntriesBeforeCursor("48"), 48);
  assert.equal(parseEntriesBeforeCursor("-1"), null);
  assert.equal(parseEntriesBeforeCursor("abc"), null);
});

test("limit clamps to [1,200] with default 50", () => {
  assert.equal(clampEntriesLimit(undefined), 50);
  assert.equal(clampEntriesLimit("100"), 100);
  assert.equal(clampEntriesLimit("9999"), 200);
  assert.equal(clampEntriesLimit("0"), 1);
});

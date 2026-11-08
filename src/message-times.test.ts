import assert from "node:assert/strict";
import { test } from "node:test";
import { collectMessageTimes, MESSAGE_TIME_TABLES, messageTimeMs } from "./message-times";

test("the session-messages table stores epoch milliseconds, and they are read as times", () => {
  const times = collectMessageTimes([
    { id: "a", created_at: 1794150793000 },
    { id: "b", created_at: "1794150794000" },
  ]);
  assert.deepEqual(times, { a: 1794150793000, b: 1794150794000 });
});

test("legacy SQLite datetime text is still read as UTC", () => {
  assert.equal(messageTimeMs("2026-11-08 10:00:00"), Date.UTC(2026, 10, 8, 10, 0, 0));
  assert.equal(messageTimeMs("2026-11-08T10:00:00Z"), Date.UTC(2026, 10, 8, 10, 0, 0));
});

test("zero and unparseable times are dropped rather than shown as 1970", () => {
  assert.deepEqual(collectMessageTimes([{ id: "z", created_at: 0 }, { id: "x", created_at: "soon" }]), {});
});

test("the current session table is read before the legacy one", () => {
  assert.deepEqual([...MESSAGE_TIME_TABLES], ["cf_agents_session_messages", "assistant_messages"]);
});

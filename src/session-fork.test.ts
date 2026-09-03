import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { selectForkCutoffSql } from "./session-fork";

test("fork cutoff ignores malformed legacy metadata", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE conversation_entries (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        meta_json TEXT,
        ui_message_id TEXT GENERATED ALWAYS AS (
          CASE WHEN json_valid(meta_json) THEN json_extract(meta_json, '$.uiMessageId') END
        ) VIRTUAL
      );
    `);
    const insert = database.prepare(
      "INSERT INTO conversation_entries (id, session_id, owner_email, meta_json) VALUES (?, ?, ?, ?)",
    );
    insert.run(1, "source-session", "owner@example.com", JSON.stringify({ uiMessageId: "message-1" }));
    insert.run(2, "source-session", "owner@example.com", "legacy metadata");

    const cutoff = database.prepare(selectForkCutoffSql).get(
      "source-session",
      "owner@example.com",
      "message-1",
    ) as { id: number } | undefined;

    assert.equal(cutoff?.id, 1);
  } finally {
    database.close();
  }
});

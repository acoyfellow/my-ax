import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationSearchQuery } from "./conversation-search";
import { testDb } from "./domain/test-db";

type Row = { entryId: number; sessionId: string; sessionName: string | null; ts: string; role: string; snippet: string };

function seeded() {
  const db = testDb();
  db.exec(`INSERT INTO sessions (id, owner_email, name, created_at, updated_at) VALUES ('s-deploy', 'o@example.com', 'Deploy fixes', datetime('now'), datetime('now')), ('s-widget', 'o@example.com', 'Widget bug', datetime('now'), datetime('now')), ('s-other', 'x@example.com', 'Someone else', datetime('now'), datetime('now'))`);
  const add = (session: string, owner: string, role: string, content: string, ts: string) =>
    db.exec(`INSERT INTO conversation_entries (session_id, owner_email, role, content, ts) VALUES ('${session}', '${owner}', '${role}', '${content}', '${ts}')`);
  add("s-deploy", "o@example.com", "user", "the wrangler deploy failed on the D1 migration", "2026-11-01T10:00:00Z");
  add("s-deploy", "o@example.com", "assistant", "the migration 0043 deploy now passes", "2026-11-01T10:05:00Z");
  add("s-widget", "o@example.com", "user", "the widget deploy shows a blank frame", "2026-11-02T09:00:00Z");
  add("s-other", "x@example.com", "user", "secret deploy notes for another owner", "2026-11-03T09:00:00Z");
  return db;
}

async function run(db: ReturnType<typeof testDb>, query: string, options: Parameters<typeof buildConversationSearchQuery>[2]) {
  const built = buildConversationSearchQuery(query, "O@example.com", options);
  assert.ok(built);
  return ((await db.prepare(built.sql).bind(...built.params).all()).results ?? []) as Row[];
}

test("search finds entries across sessions with entry ids, session names and snippets, owner only", async () => {
  const rows = await run(seeded(), "deploy", {});
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => typeof row.entryId === "number" && row.snippet.includes("<<deploy>>")));
  assert.deepEqual(new Set(rows.map((row) => row.sessionName)), new Set(["Deploy fixes", "Widget bug"]));
  assert.ok(!rows.some((row) => row.sessionId === "s-other"));
});

test("a session id filter keeps results to that session", async () => {
  const rows = await run(seeded(), "deploy", { sessionId: "s-widget" });
  assert.deepEqual(rows.map((row) => row.sessionId), ["s-widget"]);
});

test("limit and offset page through results without repeats", async () => {
  const db = seeded();
  const first = await run(db, "deploy", { sort: "recent", limit: 2, offset: 0 });
  const second = await run(db, "deploy", { sort: "recent", limit: 2, offset: 2 });
  assert.equal(first.length, 2);
  assert.equal(second.length, 1);
  assert.equal(new Set([...first, ...second].map((row) => row.entryId)).size, 3);
  assert.equal(first[0].sessionId, "s-widget");
});

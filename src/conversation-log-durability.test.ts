import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { appendConversationLog } from "./conversation-log";
import type { Env } from "./types";

const OWNER = { email: "owner@example.com", sub: "owner", groups: [] } as const;
const SESSION = "session-durability";
const LONG_REASONING = "The owner wants a plan for every platform. ".repeat(400);

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = OFF;");
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(new URL(file, directory), "utf8");
    try {
      database.exec(sql);
    } catch (error) {
      if (!/conversation_entries|ui_message_id/i.test(sql)) continue;
      throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const sessionColumns = (database.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string; notnull: number; dflt_value: unknown }>)
    .filter((column) => column.notnull && column.dflt_value === null && column.name !== "id")
    .map((column) => column.name);
  database.prepare(`INSERT INTO sessions (id${sessionColumns.map((name) => `, ${name}`).join("")}) VALUES (?${sessionColumns.map(() => ", ?").join("")})`)
    .run(SESSION, ...sessionColumns.map((name) => (name === "owner_email" ? OWNER.email : "seed")));
  return database;
}

function d1Over(database: DatabaseSync): Env["DB"] {
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    async run() {
      const result = database.prepare(sql).run(...(values as never[]));
      return { success: true, meta: { changes: Number(result.changes) } };
    },
    async first<T>() {
      return (database.prepare(sql).get(...(values as never[])) ?? null) as T | null;
    },
    async all<T>() {
      return { results: database.prepare(sql).all(...(values as never[])) as T[] };
    },
  });
  return { prepare: (sql: string) => statement(sql) } as unknown as Env["DB"];
}

function envWith(database: DatabaseSync): Env {
  return { DB: d1Over(database) } as unknown as Env;
}

async function logReply(env: Env, uiMessageId: string, content: string) {
  await appendConversationLog(env, OWNER as never, SESSION, {
    ts: new Date().toISOString(),
    role: "assistant",
    content,
    meta: { uiMessageId, model: "test-model", reasoning: LONG_REASONING, status: "completed" },
  });
}

test("a reply with long reasoning stores complete, valid metadata", async () => {
  const database = migratedDatabase();
  try {
    await logReply(envWith(database), "reply-1", "This is a meaty one.");
    const row = database.prepare("SELECT meta_json FROM conversation_entries WHERE role = 'assistant'").get() as { meta_json: string };
    const meta = JSON.parse(row.meta_json) as { uiMessageId: string; reasoning: string; status: string };
    assert.equal(meta.uiMessageId, "reply-1");
    assert.equal(meta.reasoning, LONG_REASONING);
    assert.equal(meta.status, "completed");
  } finally {
    database.close();
  }
});

test("re-syncing the same long reply five times stores exactly one row", async () => {
  const database = migratedDatabase();
  try {
    const env = envWith(database);
    for (let attempt = 0; attempt < 5; attempt++) await logReply(env, "reply-1", "This is a meaty one.");
    const rows = database.prepare("SELECT ui_message_id FROM conversation_entries WHERE role = 'assistant'").all() as Array<{ ui_message_id: string | null }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.ui_message_id, "reply-1");
  } finally {
    database.close();
  }
});

test("the database refuses a second row for the same message id", async () => {
  const database = migratedDatabase();
  try {
    await logReply(envWith(database), "reply-1", "first");
    assert.throws(() => database.prepare(
      "INSERT INTO conversation_entries(session_id, owner_email, ts, role, content, meta_json) VALUES (?, ?, ?, 'assistant', 'second', ?)",
    ).run(SESSION, OWNER.email, new Date().toISOString(), JSON.stringify({ uiMessageId: "reply-1" })), /UNIQUE/i);
  } finally {
    database.close();
  }
});

test("different replies in the same session are all kept", async () => {
  const database = migratedDatabase();
  try {
    const env = envWith(database);
    await logReply(env, "reply-1", "first");
    await logReply(env, "reply-2", "second");
    await logReply(env, "reply-1", "first");
    const count = database.prepare("SELECT COUNT(*) AS n FROM conversation_entries WHERE role = 'assistant'").get() as { n: number };
    assert.equal(count.n, 2);
  } finally {
    database.close();
  }
});

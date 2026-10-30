import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ASK_USER_TOOL } from "./tools";
import type { Env, ToolContext } from "./types";

function decisionStore() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE runs (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, session_id TEXT, status TEXT NOT NULL DEFAULT 'open', title TEXT, task_summary TEXT NOT NULL, bounds_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE run_events (run_id TEXT NOT NULL, event_id TEXT NOT NULL, owner_email TEXT NOT NULL, ts TEXT NOT NULL, actor_json TEXT NOT NULL, type TEXT NOT NULL, data_json TEXT NOT NULL, evidence_json TEXT, PRIMARY KEY (run_id, event_id));
  `);
  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async () => db.prepare(sql).get(...(params as never[])) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...(params as never[])) }),
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(params as never[])).changes) } }),
    }),
  });
  const env = { DB: { prepare } } as unknown as Env;
  const decisions = () => db.prepare("SELECT id, status FROM runs").all() as Array<{ id: string; status: string }>;
  return { env, decisions };
}

function recordingContext(env: Env, notifications: Array<{ kind: string; href?: string }>) {
  return {
    env,
    identity: { email: "OWNER@example.com" },
    sessionId: "session-1",
    async notifyOwner(input: { kind: string; href?: string }) {
      notifications.push(input);
      return { delivered: 1, expired: 0, failed: 0, devices: 1 };
    },
  } as unknown as ToolContext;
}

test("ask_user sends one owner notification when a retried decision is reused", async () => {
  const { env, decisions } = decisionStore();
  const notifications: Array<{ kind: string; href?: string }> = [];
  const context = recordingContext(env, notifications);
  const input = { question: "Choose a deployment?", options: ["Blue", "Green"] };

  const first = JSON.parse(await ASK_USER_TOOL.execute(input, context));
  const second = JSON.parse(await ASK_USER_TOOL.execute(input, context));

  assert.equal(first.ok, true);
  assert.equal(first.awaiting, true);
  assert.equal(second.ok, true);
  assert.equal(second.awaiting, true);
  assert.equal(second.decisionId, first.decisionId);
  assert.equal(second.href, first.href);
  assert.equal(decisions().length, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].kind, "job.needs_input");
  assert.equal(notifications[0].href, first.href);
});

test("ask_user with the same question but new options creates and notifies a new decision", async () => {
  const { env, decisions } = decisionStore();
  const notifications: Array<{ kind: string; href?: string }> = [];
  const context = recordingContext(env, notifications);
  const first = JSON.parse(await ASK_USER_TOOL.execute({ question: "Which flight?", options: ["UA 123", "DL 456"] }, context));
  const second = JSON.parse(await ASK_USER_TOOL.execute({ question: "Which flight?", options: ["B6 789", "AA 12"] }, context));
  assert.notEqual(second.decisionId, first.decisionId);
  assert.deepEqual(second.options, ["B6 789", "AA 12"]);
  assert.equal(notifications.length, 2);
  assert.equal(notifications[1].href, second.href);
  assert.deepEqual(decisions().map((row) => row.status).sort(), ["aborted", "open"]);
});

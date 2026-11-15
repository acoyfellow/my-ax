import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { createDecision, decisionThreadHref, registerDecisionRoutes } from "./routes/decisions";

function harness() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE runs (id TEXT PRIMARY KEY, owner_email TEXT, session_id TEXT, status TEXT DEFAULT 'open', title TEXT, task_summary TEXT, bounds_json TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), dismissed_at TEXT); CREATE TABLE run_events (run_id TEXT, event_id TEXT, owner_email TEXT, ts TEXT, actor_json TEXT, type TEXT, data_json TEXT, evidence_json TEXT)");
  const prepare = (sql: string) => ({ bind: (...p: unknown[]) => ({ first: async () => db.prepare(sql).get(...(p as never[])) ?? null, all: async () => ({ results: db.prepare(sql).all(...(p as never[])) }), run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(p as never[])).changes) } }) }) });
  const env = { DB: { prepare } } as never;
  const app = new Hono();
  app.use("*", async (c, next) => { (c as never as { set: (k: string, v: unknown) => void }).set("identity", { email: "o@x" }); await next(); });
  registerDecisionRoutes(app as never);
  return { db, env, app };
}

test("a decision links into its thread, not to a separate page", () => {
  assert.equal(decisionThreadHref("session-1", "run-decision-00000000-0000-4000-8000-000000000000"), "/?session=session-1&decision=run-decision-00000000-0000-4000-8000-000000000000");
});

test("createDecision returns the thread link for push and attention", async () => {
  const { env } = harness();
  const created = await createDecision(env, "o@x", "s1", "Ship it?", ["Yes", "No"]);
  assert.equal(created.href, `/?session=s1&decision=${created.id}`);
});

test("an open decision reports its question, options and open state as JSON", async () => {
  const { env, app } = harness();
  const created = await createDecision(env, "o@x", "s1", "Ship it?", ["Yes", "No"]);
  const response = await app.request(`/api/decisions/${created.id}/state`, {}, env);
  assert.equal(response.status, 200);
  const body = await response.json() as { result: Record<string, unknown> };
  assert.deepEqual(body.result, { id: created.id, sessionId: "s1", question: "Ship it?", options: ["Yes", "No"], state: "open", choice: null, answeredAt: null, replacedBy: null });
});

test("an answered decision is frozen with the choice and when it was made", async () => {
  const { db, env, app } = harness();
  const created = await createDecision(env, "o@x", "s1", "Ship it?", ["Yes", "No"]);
  db.prepare("UPDATE runs SET status = 'completed' WHERE id = ?").run(created.id);
  db.prepare("INSERT INTO run_events (run_id, event_id, owner_email, ts, actor_json, type, data_json) VALUES (?, 'e1', 'o@x', '2026-11-15T10:00:00Z', '{}', 'decision.answered', ?)").run(created.id, JSON.stringify({ question: "Ship it?", choice: "No" }));
  const body = await (await app.request(`/api/decisions/${created.id}/state`, {}, env)).json() as { result: Record<string, unknown> };
  assert.equal(body.result.state, "answered");
  assert.equal(body.result.choice, "No");
  assert.equal(body.result.answeredAt, "2026-11-15T10:00:00Z");
});

test("another owner cannot read a decision's state", async () => {
  const { env, app } = harness();
  const created = await createDecision(env, "someone@else", "s1", "Ship it?", ["Yes", "No"]);
  const response = await app.request(`/api/decisions/${created.id}/state`, {}, env);
  assert.equal(response.status, 404);
});

test("the legacy decision page redirects an open decision into its thread", async () => {
  const { env, app } = harness();
  const created = await createDecision(env, "o@x", "s1", "Ship it?", ["Yes", "No"]);
  const response = await app.request(`/api/decisions/${created.id}`, { redirect: "manual" }, env);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `/?session=s1&decision=${created.id}`);
});

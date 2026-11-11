import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { sqliteD1 } from "../fsm/sqlite-d1";
import { registerCostSeriesRoutes } from "./cost-series";

const schema = readFileSync(new URL("../../migrations/0013_cycle_cost.sql", import.meta.url), "utf8");
const HOUR = 60 * 60 * 1000;

function insert(database: ReturnType<typeof sqliteD1>, row: { id: string; owner: string; session: string; ageMs: number; model: string | null; tokens: number | null }) {
  database.raw.prepare(
    "INSERT INTO cycle_costs (id, owner_email, session_or_run_id, cycle_index, ts, model, input_tokens, output_tokens, total_tokens) VALUES (?, ?, ?, 0, ?, ?, NULL, NULL, ?)",
  ).run(row.id, row.owner, row.session, new Date(Date.now() - row.ageMs).toISOString(), row.model, row.tokens);
}

function appFor(email: string, database: ReturnType<typeof sqliteD1>) {
  const app = new Hono<AppEnv>();
  app.use("/api/*", async (c, next) => { c.set("identity", { email, sub: email } as never); await next(); });
  registerCostSeriesRoutes(app);
  return (path: string) => app.request(path, {}, { DB: database } as never);
}

async function summaryFor(email: string, database: ReturnType<typeof sqliteD1>) {
  const response = await appFor(email, database)("/api/cost-summary");
  assert.equal(response.status, 200);
  const body = await response.json() as { ok: boolean; result: any };
  assert.equal(body.ok, true);
  return body.result;
}

test("cost summary counts only the calling owner's rows", async () => {
  const database = sqliteD1(schema);
  insert(database, { id: "a1", owner: "alice@example.com", session: "s-a", ageMs: 1000, model: "claude-opus-5-5", tokens: 100 });
  insert(database, { id: "b1", owner: "bob@example.com", session: "s-b", ageMs: 1000, model: "claude-opus-5-5", tokens: 9000 });
  insert(database, { id: "b2", owner: "bob@example.com", session: "s-b2", ageMs: 2000, model: "secret-model", tokens: 7000 });

  const alice = await summaryFor("Alice@Example.com", database);
  assert.equal(alice.weekTokens, 100);
  assert.equal(alice.cycles, 1);
  assert.equal(alice.sessions, 1);
  assert.deepEqual(alice.models.map((model: { model: string }) => model.model), ["claude-opus-5-5"]);
  assert.equal(JSON.stringify(alice).includes("secret-model"), false);

  const bob = await summaryFor("bob@example.com", database);
  assert.equal(bob.weekTokens, 16000);
  assert.equal(bob.sessions, 2);
});

test("cost summary splits today from the last 7 days, drops older rows, and groups by model label", async () => {
  const database = sqliteD1(schema);
  const owner = "owner@example.com";
  const sinceMidnight = Date.now() - Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  insert(database, { id: "t1", owner, session: "s1", ageMs: Math.min(1000, sinceMidnight / 2), model: "claude-opus-5-5", tokens: 300 });
  insert(database, { id: "w1", owner, session: "s2", ageMs: sinceMidnight + 2 * HOUR, model: "claude-opus-5-5", tokens: 200 });
  insert(database, { id: "w2", owner, session: "s2", ageMs: 3 * 24 * HOUR, model: null, tokens: null });
  insert(database, { id: "w3", owner, session: "s3", ageMs: 5 * 24 * HOUR, model: "unlisted-model", tokens: 50 });
  insert(database, { id: "old", owner, session: "s4", ageMs: 8 * 24 * HOUR, model: "claude-opus-5-5", tokens: 100000 });

  const summary = await summaryFor(owner, database);
  assert.equal(summary.windowDays, 7);
  assert.equal(summary.todayTokens, 300);
  assert.equal(summary.weekTokens, 550);
  assert.equal(summary.cycles, 4);
  assert.equal(summary.sessions, 3);
  assert.deepEqual(summary.models, [
    { model: "claude-opus-5-5", label: "Opus 5.5", tokens: 500, cycles: 2 },
    { model: "unlisted-model", label: "unlisted-model", tokens: 50, cycles: 1 },
    { model: null, label: "Unknown model", tokens: 0, cycles: 1 },
  ]);
  assert.equal(/\$|usd|dollar|price|cost_usd/i.test(JSON.stringify(summary)), false);
});

test("cost summary for an owner with no rows is all zeros", async () => {
  const summary = await summaryFor("nobody@example.com", sqliteD1(schema));
  assert.equal(summary.todayTokens, 0);
  assert.equal(summary.weekTokens, 0);
  assert.equal(summary.cycles, 0);
  assert.equal(summary.sessions, 0);
  assert.deepEqual(summary.models, []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { formatRenderedRunsApiReceiptHref, parseRunListQuery, registerRunRoutes } from "./runs";

// Minimal D1 spy that lets each prepared statement resolve run()/first() with a
// scripted result keyed by a substring of the SQL. Enough to prove the dismiss
// endpoints' control flow (changes vs not-found vs already-dismissed).
function makeRunsDb(script: { changes?: number; exists?: boolean }) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const prepare = (sql: string) => {
    const stmt: any = {
      _binds: [] as unknown[],
      bind(...args: unknown[]) { this._binds = args; return this; },
      async run() { calls.push({ sql, binds: this._binds }); return { success: true, meta: { changes: script.changes ?? 0 } }; },
      async first() {
        calls.push({ sql, binds: this._binds });
        if (/SELECT 1 AS ok FROM runs/.test(sql)) return script.exists ? { ok: 1 } : null;
        return null;
      },
      async all() { calls.push({ sql, binds: this._binds }); return { results: [] }; },
    };
    return stmt;
  };
  return { calls, DB: { prepare } };
}

function makeRunsApp() {
  const app = new Hono<AppEnv>();
  const gate = async (c: any, next: any) => { c.set("identity", { email: "owner@example.com", sub: "test-owner" }); await next(); };
  app.use("/api/runs", gate);
  app.use("/api/runs/*", gate);
  registerRunRoutes(app);
  return app;
}

test("POST /api/runs/:id/dismiss marks a run dismissed (owner-scoped update)", async () => {
  const app = makeRunsApp();
  const db = makeRunsDb({ changes: 1 });
  const res = await app.fetch(new Request("http://t/api/runs/r1/dismiss", { method: "POST" }), { DB: db.DB } as any);
  assert.equal(res.status, 200);
  const body = await res.json<any>();
  assert.equal(body.result.dismissed, true);
  const upd = db.calls.find((c) => /UPDATE runs SET dismissed_at/.test(c.sql));
  assert.ok(upd, "issued the dismiss UPDATE");
  assert.deepEqual(upd!.binds, ["r1", "owner@example.com"]);
});

test("POST /api/runs/:id/dismiss on an unknown run is 404", async () => {
  const app = makeRunsApp();
  const db = makeRunsDb({ changes: 0, exists: false });
  const res = await app.fetch(new Request("http://t/api/runs/ghost/dismiss", { method: "POST" }), { DB: db.DB } as any);
  assert.equal(res.status, 404);
});

test("POST /api/runs/:id/dismiss on an already-dismissed run is an idempotent 200", async () => {
  const app = makeRunsApp();
  const db = makeRunsDb({ changes: 0, exists: true });
  const res = await app.fetch(new Request("http://t/api/runs/r1/dismiss", { method: "POST" }), { DB: db.DB } as any);
  assert.equal(res.status, 200);
});

test("POST /api/runs/dismiss-all clears all undismissed runs and reports the count", async () => {
  const app = makeRunsApp();
  const db = makeRunsDb({ changes: 3 });
  const res = await app.fetch(new Request("http://t/api/runs/dismiss-all", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { DB: db.DB } as any);
  assert.equal(res.status, 200);
  const body = await res.json<any>();
  assert.equal(body.result.dismissed, 3);
});

test("parseRunListQuery accepts a supported status filter", () => {
  const result = parseRunListQuery(new URL("https://example.com/api/runs?status=failed&limit=250"));
  assert.deepEqual(result, { limit: 100, status: "failed", invalidStatus: null });
});

test("parseRunListQuery reports unsupported status filters", () => {
  const result = parseRunListQuery(new URL("https://example.com/api/runs?status=stuck&limit=0"));
  assert.deepEqual(result, { limit: 1, status: null, invalidStatus: "stuck" });
});

test("parseRunListQuery keeps status optional", () => {
  const result = parseRunListQuery(new URL("https://example.com/api/runs"));
  assert.deepEqual(result, { limit: 25, status: null, invalidStatus: null });
});

test("formatRenderedRunsApiReceiptHref preserves active rendered status filters", () => {
  assert.equal(formatRenderedRunsApiReceiptHref("failed"), "/api/runs?status=failed");
  assert.equal(formatRenderedRunsApiReceiptHref("open"), "/api/runs?status=open");
  assert.equal(formatRenderedRunsApiReceiptHref(null), "/api/runs");
});

import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createTerrariumWorkProvider, TERRARIUM_WORK_METHODS } from "./terrarium-tools";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// Minimal ctx + a global fetch stub (the connector calls global fetch directly).
function ctxWith(fetchImpl: typeof fetch, env: Record<string, unknown> = {}) {
  globalThis.fetch = fetchImpl;
  return {
    env: { TERRARIUM_URL: "https://terrarium.example", TERRARIUM_CONTROL_TOKEN: "tok_test", ...env },
    identity: { email: "owner@example.com" },
  } as any;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("catalog advertises spawn, spawn_background, status", () => {
  assert.deepEqual(TERRARIUM_WORK_METHODS.map((m) => m.name).sort(), ["spawn", "spawn_background", "status"]);
});

test("configuration fails closed without URL+token", async () => {
  const provider = createTerrariumWorkProvider(ctxWith((async () => jsonResponse(200, {})) as any, { TERRARIUM_CONTROL_TOKEN: "" }));
  await assert.rejects(() => provider.fns.spawn({ task: "x" }), /not configured/);
});

test("spawn rejects an empty task before any network call", async () => {
  let called = false;
  const provider = createTerrariumWorkProvider(ctxWith((async () => { called = true; return jsonResponse(200, {}); }) as any));
  await assert.rejects(() => provider.fns.spawn({ task: "  " }), /non-empty/);
  assert.equal(called, false);
});

test("spawn posts task with Bearer + Idempotency-Key and polls to a verified receipt", async () => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), method: init.method ?? "GET", headers, body: init.body as string | undefined });
    if (String(url).endsWith("/api/runs")) return jsonResponse(202, { runId: "ter_abc_deadbeef01", contract: { nonce: "n1" } });
    // status poll -> terminal done
    return jsonResponse(200, { status: { status: "done", terminal: { ok: true, exitCode: 0, taskContractStatus: "verified", taskResultSummary: "391", reason: "verified-receipt" } } });
  }) as any;
  const provider = createTerrariumWorkProvider(ctxWith(fetchImpl));
  const res = (await provider.fns.spawn({ task: "compute 17*23", timeoutMs: 60000, model: "gpt-5.6-sol" })) as any;

  assert.equal(res.ok, true);
  assert.equal(res.runId, "ter_abc_deadbeef01");
  assert.equal(res.status, "done");
  assert.equal(res.taskContractStatus, "verified");
  assert.equal(res.taskResultSummary, "391");

  const post = calls.find((c) => c.url.endsWith("/api/runs"));
  assert.ok(post, "posted to /api/runs");
  assert.equal(post!.method, "POST");
  assert.equal(post!.headers.authorization, "Bearer tok_test");
  assert.ok(post!.headers["idempotency-key"], "idempotency-key present");
  const sent = JSON.parse(post!.body!);
  assert.equal(sent.task, "compute 17*23");
  assert.equal(sent.spec.deadlineMs, 60000);
  assert.equal(sent.spec.model, "gpt-5.6-sol");
});

test("spawn surfaces a non-202 admission failure as a thrown error", async () => {
  const fetchImpl = (async () => jsonResponse(429, { error: "budget exceeded" })) as any;
  const provider = createTerrariumWorkProvider(ctxWith(fetchImpl));
  await assert.rejects(() => provider.fns.spawn({ task: "x" }), /budget exceeded/);
});

test("spawn_background returns the runId immediately without polling", async () => {
  let statusPolls = 0;
  const fetchImpl = (async (url: string) => {
    if (String(url).endsWith("/api/runs")) return jsonResponse(202, { runId: "ter_bg_00112233aa", contract: {} });
    statusPolls++;
    return jsonResponse(200, { status: { status: "running" } });
  }) as any;
  const provider = createTerrariumWorkProvider(ctxWith(fetchImpl));
  const res = (await provider.fns.spawn_background({ task: "long job" })) as any;
  assert.equal(res.ok, true);
  assert.equal(res.runId, "ter_bg_00112233aa");
  assert.equal(res.status, "running");
  assert.equal(res.background, true);
  assert.equal(statusPolls, 0, "background spawn must not poll status");
});

test("status maps a terminal receipt", async () => {
  const fetchImpl = (async () => jsonResponse(200, { status: { status: "done", terminal: { ok: true, taskContractStatus: "verified", taskResultSummary: "ok" } } })) as any;
  const provider = createTerrariumWorkProvider(ctxWith(fetchImpl));
  const res = (await provider.fns.status({ runId: "ter_x_1122334455" })) as any;
  assert.equal(res.ok, true);
  assert.equal(res.status, "done");
  assert.equal(res.taskContractStatus, "verified");
});

test("status requires a runId", async () => {
  const provider = createTerrariumWorkProvider(ctxWith((async () => jsonResponse(200, {})) as any));
  await assert.rejects(() => provider.fns.status({}), /requires \{runId\}/);
});

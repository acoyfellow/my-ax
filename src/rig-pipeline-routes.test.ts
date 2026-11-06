import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Hono } from "hono";
import { registerDecisionRoutes } from "./routes/decisions";
import { parseStart, registerRigRoutes } from "./routes/rig";
import { RIG_APPROVAL_EVENT, RIG_IMAGE_EVENT } from "./rig-pipeline";
import { createRigDecision, gitlabPreviewTrigger, recordRigEvent, summarizeChecks } from "./rig-pipeline-workflow";

const OWNER = "owner@example.com";

function fixture(enabled = "1") {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE runs (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, session_id TEXT, status TEXT NOT NULL DEFAULT 'open', title TEXT, task_summary TEXT NOT NULL, bounds_json TEXT NOT NULL, created_at TEXT, updated_at TEXT);
    CREATE TABLE run_events (run_id TEXT NOT NULL, event_id TEXT NOT NULL, owner_email TEXT NOT NULL, ts TEXT NOT NULL, actor_json TEXT NOT NULL, type TEXT NOT NULL, data_json TEXT NOT NULL, evidence_json TEXT, PRIMARY KEY (run_id, event_id));
  `);
  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async () => db.prepare(sql).get(...(params as never[])) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...(params as never[])) }),
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(params as never[])).changes) } }),
    }),
  });
  const created: Array<{ id: string; params: unknown }> = [];
  const sent: Array<{ instanceId: string; type: string; payload: unknown }> = [];
  const RIG_PIPELINE = {
    create: async (options: { id: string; params: unknown }) => { created.push(options); return {}; },
    get: async (instanceId: string) => ({
      sendEvent: async (event: { type: string; payload: unknown }) => { sent.push({ instanceId, ...event }); },
      status: async () => ({ status: "waiting" }),
    }),
  };
  const env = { DB: { prepare }, RIG_PIPELINE, RIG_PIPELINE_ENABLED: enabled };
  const app = new Hono<never>();
  app.use("*", async (c, next) => { (c as unknown as { set: (k: string, v: unknown) => void }).set("identity", { email: OWNER }); await next(); });
  registerDecisionRoutes(app as never);
  registerRigRoutes(app as never);
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);
  const get = (path: string) => app.request(path, undefined, env);
  const status = (id: string) => (db.prepare("SELECT status FROM runs WHERE id = ?").get(id) as { status: string } | undefined)?.status;
  return { env, created, sent, post, get, status };
}

test("the rig API is off unless RIG_PIPELINE_ENABLED is 1", async () => {
  const { post, created } = fixture("");
  const response = await post("/api/rig/runs", { target: "pr-416", commit: "abc1234" });
  assert.equal(response.status, 404);
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "RIG_DISABLED");
  assert.equal(created.length, 0);
});

test("starting a run records a receipt row and creates the workflow instance with the same id", async () => {
  const { post, created, status } = fixture();
  const response = await post("/api/rig/runs", { target: "pr-416", commit: "abc1234", verifyUrl: "https://pr-416.example.dev/" });
  assert.equal(response.status, 201);
  const { result } = (await response.json()) as { result: { runId: string } };
  assert.equal(created[0]?.id, result.runId);
  assert.deepEqual(created[0]?.params, { ownerEmail: OWNER, runId: result.runId, target: "pr-416", commit: "abc1234", verifyUrl: "https://pr-416.example.dev/" });
  assert.equal(status(result.runId), "open");
});

test("the image event reaches the workflow only for an open run the owner has", async () => {
  const { post, sent } = fixture();
  const started = (await (await post("/api/rig/runs", { target: "pr-416", commit: "abc1234" })).json()) as { result: { runId: string } };
  const ok = await post(`/api/rig/runs/${started.result.runId}/image`, { image: "registry.example/my-ax-computer:voxl-abc1234" });
  assert.equal(ok.status, 200);
  assert.deepEqual(sent, [{ instanceId: started.result.runId, type: RIG_IMAGE_EVENT, payload: { image: "registry.example/my-ax-computer:voxl-abc1234" } }]);
  const missing = await post(`/api/rig/runs/rig-00000000-0000-0000-0000-000000000000/image`, { image: "x:y" });
  assert.equal(missing.status, 404);
});

test("answering a rig approval push resumes the workflow instead of a chat session", async () => {
  const { env, post, sent, status } = fixture();
  const params = { ownerEmail: OWNER, runId: "rig-11111111-1111-1111-1111-111111111111", target: "pr-416", commit: "abc1234" };
  const decision = await createRigDecision(env as never, params, "registry.example/img:1");
  const response = await post(`/api/decisions/${decision.id}/respond`, { choice: "Deploy" });
  assert.equal(response.status, 200);
  assert.deepEqual(sent, [{ instanceId: params.runId, type: RIG_APPROVAL_EVENT, payload: { choice: "Deploy", via: "push" } }]);
  assert.equal(status(decision.id), "completed");
});

test("rig receipts move the run to its terminal status", async () => {
  const { env, post, status } = fixture();
  const started = (await (await post("/api/rig/runs", { target: "pr-416", commit: "abc1234" })).json()) as { result: { runId: string } };
  const params = { ownerEmail: OWNER, runId: started.result.runId, target: "pr-416", commit: "abc1234" };
  await recordRigEvent(env as never, params, "rig.approved", {});
  assert.equal(status(params.runId), "open");
  await recordRigEvent(env as never, params, "rig.rejected", {});
  assert.equal(status(params.runId), "aborted");
});

test("start input is validated", () => {
  assert.equal(typeof parseStart({ target: "PR 416", commit: "abc1234" }), "string");
  assert.equal(typeof parseStart({ target: "pr-416", commit: "zz" }), "string");
  assert.equal(typeof parseStart({ target: "pr-416", commit: "abc1234", verifyUrl: "http://x.dev" }), "string");
  assert.deepEqual(parseStart({ target: "prod", commit: "abc1234" }), { target: "prod", commit: "abc1234" });
});

test("check runs are pending until all complete and fail on any failing conclusion", () => {
  assert.equal(summarizeChecks([]), "pending");
  assert.equal(summarizeChecks([{ status: "in_progress", conclusion: null }, { status: "completed", conclusion: "success" }]), "pending");
  assert.equal(summarizeChecks([{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "skipped" }]), "success");
  assert.equal(summarizeChecks([{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "failure" }]), "failure");
});

test("the deploy step triggers the internal GitLab preview pipeline with the PR number and pushed image", () => {
  const params = { ownerEmail: OWNER, runId: "rig-1", target: "pr-416", commit: "abc1234" };
  const trigger = gitlabPreviewTrigger({ url: "https://ci.internal.example/api/v4/projects/1/trigger/pipeline", token: "t0k" }, params, "registry.example/img:1");
  assert.ok("url" in trigger);
  assert.equal(trigger.url, "https://ci.internal.example/api/v4/projects/1/trigger/pipeline");
  assert.equal(trigger.body.get("ref"), "main");
  assert.equal(trigger.body.get("variables[DEPLOY_TARGET]"), "preview");
  assert.equal(trigger.body.get("variables[PR]"), "416");
  assert.equal(trigger.body.get("variables[PREVIEW_COMPUTER_IMAGE]"), "registry.example/img:1");
});

test("the rig never triggers a production deploy and needs its trigger secrets", () => {
  const prod = gitlabPreviewTrigger({ url: "https://ci.internal.example/t", token: "t0k" }, { ownerEmail: OWNER, runId: "rig-1", target: "prod", commit: "abc1234" }, "img:1");
  assert.ok("error" in prod && /production deploys stay manual/.test(prod.error));
  const unset = gitlabPreviewTrigger({}, { ownerEmail: OWNER, runId: "rig-1", target: "pr-416", commit: "abc1234" }, "img:1");
  assert.ok("error" in unset);
});

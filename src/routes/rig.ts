import type { Context, Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { RIG_IMAGE_EVENT, type RigPipelineParams } from "../rig-pipeline";
import { rigPipelineEnabled } from "../rig-pipeline-workflow";

const RUN_ID_RE = /^rig-[0-9a-f-]{36}$/i;
const COMMIT_RE = /^[0-9a-f]{7,40}$/i;
const TARGET_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const IMAGE_RE = /^[a-z0-9./_:-]{1,300}$/i;

type StartBody = { target?: unknown; commit?: unknown; verifyUrl?: unknown };

function failure(c: Context<AppEnv>, status: 400 | 404 | 409, code: string, message: string) {
  return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code, message }, next_actions: [] }, status);
}

export function parseStart(body: StartBody): { target: string; commit: string; verifyUrl?: string } | string {
  const target = typeof body.target === "string" ? body.target.trim() : "";
  const commit = typeof body.commit === "string" ? body.commit.trim() : "";
  if (!TARGET_RE.test(target)) return "target must be a lowercase name like pr-416 or prod";
  if (!COMMIT_RE.test(commit)) return "commit must be a 7 to 40 character hex sha";
  if (body.verifyUrl === undefined) return { target, commit };
  if (typeof body.verifyUrl !== "string") return "verifyUrl must be an https URL";
  const url = URL.canParse(body.verifyUrl) ? new URL(body.verifyUrl) : null;
  if (!url || url.protocol !== "https:") return "verifyUrl must be an https URL";
  return { target, commit, verifyUrl: url.toString() };
}

export function registerRigRoutes(app: Hono<AppEnv>) {
  app.use("/api/rig/*", async (c, next) => {
    if (!rigPipelineEnabled(c.env)) return failure(c, 404, "RIG_DISABLED", "the rig pipeline is off; set RIG_PIPELINE_ENABLED=1");
    await next();
  });

  app.post("/api/rig/runs", async (c) => {
    const parsed = parseStart(await c.req.json<StartBody>().catch(() => ({})));
    if (typeof parsed === "string") return failure(c, 400, "BAD_INPUT", parsed);
    const ownerEmail = c.get("identity").email.toLowerCase();
    const runId = `rig-${crypto.randomUUID()}`;
    await c.env.DB.prepare("INSERT INTO runs(id, owner_email, session_id, status, title, task_summary, bounds_json, created_at, updated_at) VALUES (?, ?, NULL, 'open', ?, ?, ?, datetime('now'), datetime('now'))")
      .bind(runId, ownerEmail, "Rig pipeline", `Deploy ${parsed.commit} to ${parsed.target}`, JSON.stringify({ surface: "rig", ...parsed })).run();
    const params: RigPipelineParams = { ownerEmail, runId, ...parsed };
    await c.env.RIG_PIPELINE.create({ id: runId, params });
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { runId, href: `/api/rig/runs/${runId}` }, next_actions: [] }, 201);
  });

  app.get("/api/rig/runs", async (c) => {
    const ownerEmail = c.get("identity").email.toLowerCase();
    const rows = await c.env.DB.prepare("SELECT id, status, task_summary, created_at, updated_at FROM runs WHERE owner_email = ? AND id LIKE 'rig-%' ORDER BY created_at DESC LIMIT 50")
      .bind(ownerEmail).all<{ id: string; status: string; task_summary: string; created_at: string; updated_at: string }>();
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { runs: rows.results ?? [] }, next_actions: [] });
  });

  app.get("/api/rig/runs/:id", async (c) => {
    const runId = c.req.param("id");
    if (!RUN_ID_RE.test(runId)) return failure(c, 400, "BAD_ID", "invalid rig run id");
    const ownerEmail = c.get("identity").email.toLowerCase();
    const run = await c.env.DB.prepare("SELECT id, status, task_summary, created_at, updated_at FROM runs WHERE id = ? AND owner_email = ?").bind(runId, ownerEmail).first();
    if (!run) return failure(c, 404, "NOT_FOUND", "rig run not found");
    const events = await c.env.DB.prepare("SELECT ts, type, data_json FROM run_events WHERE run_id = ? AND owner_email = ? ORDER BY ts").bind(runId, ownerEmail).all<{ ts: string; type: string; data_json: string }>();
    const workflow = await (await c.env.RIG_PIPELINE.get(runId)).status().catch(() => null);
    return c.json<ApiResponse>({
      ok: true,
      command: c.req.path,
      result: { run, workflow, events: (events.results ?? []).map((event) => ({ ts: event.ts, type: event.type, data: JSON.parse(event.data_json) })) },
      next_actions: [],
    });
  });

  app.post("/api/rig/runs/:id/image", async (c) => {
    const runId = c.req.param("id");
    if (!RUN_ID_RE.test(runId)) return failure(c, 400, "BAD_ID", "invalid rig run id");
    const ownerEmail = c.get("identity").email.toLowerCase();
    const owned = await c.env.DB.prepare("SELECT status FROM runs WHERE id = ? AND owner_email = ?").bind(runId, ownerEmail).first<{ status: string }>();
    if (!owned) return failure(c, 404, "NOT_FOUND", "rig run not found");
    if (owned.status !== "open") return failure(c, 409, "NOT_OPEN", "rig run is finished");
    const body = await c.req.json<{ image?: unknown }>().catch(() => ({} as { image?: unknown }));
    const image = typeof body.image === "string" ? body.image.trim() : "";
    if (!IMAGE_RE.test(image)) return failure(c, 400, "BAD_INPUT", "image must be a registry reference");
    await (await c.env.RIG_PIPELINE.get(runId)).sendEvent({ type: RIG_IMAGE_EVENT, payload: { image } });
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { runId, image }, next_actions: [] });
  });
}

// Owns: HTTP parsing and response mapping for recurring jobs.
// Called by: authenticated Hono application composition.
// Does not own: job business rules, scheduling, ownership, quota, or evidence.

import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { JobService, JobServiceError } from "../job-service";
import type { JobRow, JobStatus } from "../jobs";

const JOB_STATUSES = new Set<JobStatus>(["active", "paused"]);

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);
}

function jobStatusClass(status: JobStatus): string {
  return status === "active" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : "border-amber-500/30 bg-amber-500/10 text-amber-700";
}

function renderJobsPage(input: { identityEmail: string; buildId?: string | null; status?: JobStatus; jobs: JobRow[]; statusCode?: number; error?: string }) {
  const title = input.error ? "Unsupported job filter" : "Jobs";
  const filterText = input.status ? ` · status: ${input.status}` : "";
  const nav = Array.from(JOB_STATUSES).map((status) => `<a class="rounded-full border px-3 py-1 text-xs font-semibold ${input.status === status ? "border-brand bg-brand/10 text-brand" : "border-line text-fg-mut hover:text-fg"}" href="/jobs?status=${status}">${status}</a>`).join("");
  const body = input.error
    ? `<section class="rounded-2xl border border-line bg-bg-alt p-6 text-sm text-fg-mut">${escapeHtml(input.error)} <a class="text-brand" href="/jobs">View all jobs.</a></section>`
    : input.jobs.length
      ? `<ol class="space-y-3">${input.jobs.map((job) => `<li class="rounded-2xl border border-line bg-bg-alt p-4" data-job-list-item="${escapeHtml(job.id)}"><div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 class="text-sm font-semibold text-fg">${escapeHtml(job.name)}</h2><p class="mt-1 line-clamp-3 text-sm leading-6 text-fg-mut">${escapeHtml(job.prompt)}</p></div><span class="rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${jobStatusClass(job.status)}">${escapeHtml(job.status)}</span></div><div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-mut"><a class="rounded-full bg-brand px-3 py-1.5 font-bold text-white hover:opacity-90" href="/api/jobs/${escapeHtml(job.id)}/history">History receipt</a><span>next ${escapeHtml(job.next_run_at)}</span><code class="font-mono text-[10px]">${escapeHtml(job.id)}</code></div></li>`).join("")}</ol>`
      : `<section class="rounded-2xl border border-line bg-bg-alt p-6 text-sm text-fg-mut" data-jobs-empty><p>No jobs match this view.</p><div class="mt-4 flex flex-wrap gap-2"><a class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:border-brand hover:text-brand" href="/">Back to Check-in</a><a class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:border-brand hover:text-brand" href="/jobs">View all jobs</a><a class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:border-brand hover:text-brand" href="/api/jobs">API receipt</a></div></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · My Agent Experience</title><link rel="stylesheet" href="/static/styles.css"></head><body class="bg-bg text-fg"><main class="min-h-dvh bg-bg text-fg" data-jobs-page><section class="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8"><header class="rounded-2xl border border-line bg-bg-alt p-5"><a class="text-xs font-semibold text-fg-mut hover:text-fg" href="/">← Back to shell</a><h1 class="mt-3 text-3xl font-bold">${title}</h1><p class="mt-1 text-sm text-fg-mut">${input.error ? "Filter rejected" : `${input.jobs.length} shown${filterText}`}</p><div class="mt-4 flex flex-wrap gap-2">${nav}<a class="rounded-full border border-line px-3 py-1 text-xs font-semibold text-fg-mut hover:text-fg" href="/api/jobs">API receipt</a></div><nav class="mt-3 flex flex-wrap gap-2" data-jobs-next-actions><a class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:border-brand hover:text-brand" href="/">Back to Check-in</a><a class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:border-brand hover:text-brand" href="/jobs">View all jobs</a><a class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:border-brand hover:text-brand" href="/api/jobs">API receipt</a></nav></header>${body}</section><footer hidden data-build-id="${escapeHtml(input.buildId ?? "")}" data-owner="${escapeHtml(input.identityEmail)}"></footer></main></body></html>`;
}

export function parseJobListQuery(url: string): { status?: JobStatus; error?: { code: "BAD_JOB_STATUS"; message: string } } {
  const status = new URL(url).searchParams.get("status")?.trim();
  if (!status) return {};
  if (!JOB_STATUSES.has(status as JobStatus)) return { error: { code: "BAD_JOB_STATUS", message: `Unsupported job status: ${status}` } };
  return { status: status as JobStatus };
}

function failure(c: Context<AppEnv>, command: string, error: unknown) {
  const known = error instanceof JobServiceError;
  const code = known ? error.code : "InternalError";
  const status: ContentfulStatusCode = code === "InvalidInput" ? 400 : code === "NotFound" ? 404 : code === "QuotaExceeded" ? 429 : code === "Conflict" ? 409 : 500;
  return c.json<ApiResponse>({ ok: false, command, error: { code, message: error instanceof Error ? error.message : String(error) }, next_actions: [] }, status);
}

export function registerJobRoutes(app: Hono<AppEnv>) {
  const body = (c: Context<AppEnv>): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));
  const service = (c: Context<AppEnv>) => new JobService(c.env, c.get("identity").email);
  const input = (v: Record<string, unknown>) => ({ sessionId: typeof v.sessionId === "string" ? v.sessionId : undefined, name: typeof v.name === "string" ? v.name : undefined, prompt: typeof v.prompt === "string" ? v.prompt : undefined, cadenceSecs: v.cadenceSecs === undefined ? undefined : Number(v.cadenceSecs) });
  const key = (c: Context<AppEnv>) => c.req.header("Idempotency-Key")?.trim().slice(0, 200);
  const ok = (c: Context<AppEnv>, command: string, result: unknown, status: ContentfulStatusCode = 200) => c.json<ApiResponse>({ ok: true, command, result, next_actions: [] }, status);

  app.get("/jobs", async c => {
    const parsed = parseJobListQuery(c.req.url);
    const identity = c.get("identity");
    if (parsed.error) return c.html(renderJobsPage({ identityEmail: identity.email, buildId: c.env.CF_VERSION_METADATA?.id, jobs: [], error: parsed.error.message }), 400);
    try {
      return c.html(renderJobsPage({ identityEmail: identity.email, buildId: c.env.CF_VERSION_METADATA?.id, status: parsed.status, jobs: await service(c).list(parsed.status) }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.html(renderJobsPage({ identityEmail: identity.email, buildId: c.env.CF_VERSION_METADATA?.id, jobs: [], error: `Jobs unavailable: ${message}` }), 500);
    }
  });

  app.get("/api/jobs", async c => {
    const parsed = parseJobListQuery(c.req.url);
    const command = parsed.status ? `GET /api/jobs?status=${parsed.status}` : "GET /api/jobs";
    if (parsed.error) return c.json<ApiResponse>({ ok: false, command, error: parsed.error, next_actions: [] }, 400);
    try { return ok(c, command, { jobs: await service(c).list(parsed.status), filter: { status: parsed.status ?? null } }); } catch (e) { return failure(c, command, e); }
  });
  app.post("/api/jobs", async c => { const command = "POST /api/jobs"; try { return ok(c, command, await service(c).create(input(await body(c)), key(c)), 201); } catch (e) { return failure(c, command, e); } });
  app.patch("/api/jobs/:id", async c => { const command = `PATCH /api/jobs/${c.req.param("id")}`; try { return ok(c, command, await service(c).update(c.req.param("id"), input(await body(c)))); } catch (e) { return failure(c, command, e); } });
  app.post("/api/jobs/:id/pause", async c => { const command = `POST /api/jobs/${c.req.param("id")}/pause`; try { const request = await body(c); return ok(c, command, await service(c).setPaused(c.req.param("id"), request.paused !== false)); } catch (e) { return failure(c, command, e); } });
  app.post("/api/jobs/:id/resume", async c => { const command = `POST /api/jobs/${c.req.param("id")}/resume`; try { return ok(c, command, await service(c).setPaused(c.req.param("id"), false)); } catch (e) { return failure(c, command, e); } });
  app.post("/api/jobs/:id/run", async c => { const command = `POST /api/jobs/${c.req.param("id")}/run`; try { return ok(c, command, await service(c).run(c.req.param("id"), key(c))); } catch (e) { return failure(c, command, e); } });
  app.delete("/api/jobs/:id", async c => { const command = `DELETE /api/jobs/${c.req.param("id")}`; try { return ok(c, command, await service(c).delete(c.req.param("id"))); } catch (e) { return failure(c, command, e); } });
  app.get("/api/jobs/:id/history", async c => { const command = `GET /api/jobs/${c.req.param("id")}/history`; try { return ok(c, command, { events: await service(c).history(c.req.param("id")) }); } catch (e) { return failure(c, command, e); } });
}

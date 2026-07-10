import type { Hono } from "hono";
import { Layout } from "../views/Layout";
import type { ApiResponse } from "../types";
import type { AppEnv } from "../app-env";
import { appendOwnedRunEvent, runEventId, RunReceiptNotFoundError, RunReceiptTerminalError, type RunActor } from "../run-receipts";
import { readThemeCookie } from "./theme";

type RunStatus = "open" | "running" | "completed" | "failed" | "aborted";

type RunRow = {
  id: string;
  owner_email: string;
  session_id: string | null;
  status: RunStatus;
  title: string | null;
  task_summary: string;
  bounds_json: string;
  created_at: string;
  updated_at: string;
};

type RunEventRow = {
  run_id: string;
  event_id: string;
  owner_email: string;
  ts: string;
  actor_json: string;
  type: string;
  data_json: string;
  evidence_json: string | null;
};

type CreateRunBody = {
  task?: string;
  title?: string;
  session_id?: string;
  bounds?: Record<string, unknown>;
};

type AppendRunEventBody = {
  event_id?: string;
  ts?: string;
  actor?: RunActor;
  type?: string;
  data?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
};

type ParsedRunEvent = RunEventRow & {
  actor: RunActor | null;
  data: Record<string, unknown> | null;
  evidence: Record<string, unknown> | null;
};

function jsonResponse<T>(command: string, result: T, next_actions: ApiResponse["next_actions"] = []): ApiResponse<T> {
  return { ok: true, command, result, next_actions };
}

function errorResponse(command: string, code: string, message: string, next_actions: ApiResponse["next_actions"] = []): ApiResponse {
  return { ok: false, command, error: { code, message }, next_actions };
}

function nowIso(): string {
  return new Date().toISOString();
}

function compactRunId(date = new Date()): string {
  const stamp = date.toISOString().replaceAll(":", "-").replace("T", "--").replace("Z", "");
  const nonce = crypto.randomUUID().slice(0, 8);
  return `ax-run-${stamp}-${nonce}`;
}

function tryParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function parseEvent(row: RunEventRow): ParsedRunEvent {
  return {
    ...row,
    actor: tryParseJson<RunActor>(row.actor_json),
    data: tryParseJson<Record<string, unknown>>(row.data_json),
    evidence: tryParseJson<Record<string, unknown>>(row.evidence_json),
  };
}

function claimSummary(events: ParsedRunEvent[]) {
  return [
    {
      label: "Human command / approval",
      status: events.some((event) => event.type === "human.command.created") ? "live" : "missing",
      event: "human.command.created",
    },
    {
      label: "Coordinator route plan",
      status: events.some((event) => event.type === "coordinator.plan.created") ? "live" : "missing",
      event: "coordinator.plan.created",
    },
    {
      label: "Machinectl observation",
      status: events.some((event) => event.type === "machinectl.observation.captured") ? "live" : "missing",
      event: "machinectl.observation.captured",
    },
  ];
}

const RUN_STATUSES = ["open", "running", "completed", "failed", "aborted"] as const;

export function parseRunListQuery(url: URL) {
  const limitRaw = parseInt(url.searchParams.get("limit") || "25", 10);
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 25));
  const statusParam = url.searchParams.get("status")?.trim() || null;
  const status = statusParam && (RUN_STATUSES as readonly string[]).includes(statusParam) ? statusParam as RunStatus : null;
  return { limit, status, invalidStatus: statusParam !== null && status === null ? statusParam : null };
}

export function formatRenderedRunsApiReceiptHref(status?: RunStatus | null): string {
  return status ? `/api/runs?status=${status}` : "/api/runs";
}

function statusClass(status: string) {
  if (status === "completed") return "text-good border-good/30 bg-good/10";
  if (status === "failed" || status === "aborted") return "text-bad border-bad/30 bg-bad/10";
  return "text-brand border-brand/30 bg-brand/10";
}

export function registerRunRoutes(app: Hono<AppEnv>) {
  app.post("/api/runs", async (c) => {
    const identity = c.get("identity");
    const body = (await c.req.json<CreateRunBody>().catch(() => ({}))) as CreateRunBody;
    const task = (body.task ?? "").trim();
    if (!task) return c.json(errorResponse("POST /api/runs", "BAD_RUN_TASK", "task is required"), 400);

    const runId = compactRunId();
    const createdAt = nowIso();
    const bounds = body.bounds && typeof body.bounds === "object" ? body.bounds : {};
    const title = (body.title ?? task).slice(0, 200);
    const sessionId = body.session_id?.trim() || null;

    await c.env.DB.prepare(
      "INSERT INTO runs (id, owner_email, session_id, status, title, task_summary, bounds_json, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?)",
    ).bind(runId, identity.email, sessionId, title, task, JSON.stringify(bounds), createdAt, createdAt).run();

    const humanEvent = {
      event_id: runEventId("human.command.created"),
      ts: createdAt,
      actor: { id: "human:current-user", kind: "human", mode: "live" },
      type: "human.command.created",
      data: { task, bounds, source: "my-ax" },
    };
    await c.env.DB.prepare(
      "INSERT INTO run_events (run_id, event_id, owner_email, ts, actor_json, type, data_json, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
    ).bind(runId, humanEvent.event_id, identity.email, humanEvent.ts, JSON.stringify(humanEvent.actor), humanEvent.type, JSON.stringify(humanEvent.data)).run();

    return c.json(jsonResponse("POST /api/runs", {
      runId,
      receiptUrl: `/runs/${runId}`,
      events: [humanEvent.type],
    }, [
      { command: `POST /api/runs/${runId}/events`, description: "Append a live tool/harness/verification event" },
      { command: `GET /runs/${runId}`, description: "Open the Run Board" },
    ]), 201);
  });

  app.get("/api/runs", async (c) => {
    const identity = c.get("identity");
    const url = new URL(c.req.url);
    const { limit, status, invalidStatus } = parseRunListQuery(url);
    if (invalidStatus) return c.json(errorResponse("GET /api/runs", "BAD_RUN_STATUS", `unsupported run status: ${invalidStatus}`), 400);
    // Dismissed runs are hidden from list views (notifications stream) but the
    // rows/receipts are preserved. Reversible via clearing dismissed_at.
    const rows = status
      ? await c.env.DB.prepare(
        "SELECT id, status, title, task_summary, created_at, updated_at FROM runs WHERE owner_email = ? AND status = ? AND dismissed_at IS NULL ORDER BY updated_at DESC LIMIT ?",
      ).bind(identity.email, status, limit).all()
      : await c.env.DB.prepare(
        "SELECT id, status, title, task_summary, created_at, updated_at FROM runs WHERE owner_email = ? AND dismissed_at IS NULL ORDER BY updated_at DESC LIMIT ?",
      ).bind(identity.email, limit).all();
    return c.json(jsonResponse("GET /api/runs", { runs: rows.results ?? [], limit, status }));
  });

  app.get("/api/runs/:id", async (c) => {
    const identity = c.get("identity");
    const id = c.req.param("id");
    const run = await c.env.DB.prepare(
      "SELECT * FROM runs WHERE id = ? AND owner_email = ?",
    ).bind(id, identity.email).first<RunRow>();
    if (!run) return c.json(errorResponse(c.req.path, "RUN_NOT_FOUND", "run not found or not owned"), 404);
    return c.json(jsonResponse(c.req.path, { run: { ...run, bounds: tryParseJson<Record<string, unknown>>(run.bounds_json) } }));
  });

  app.get("/api/runs/:id/events", async (c) => {
    const identity = c.get("identity");
    const id = c.req.param("id");
    const run = await c.env.DB.prepare(
      "SELECT id FROM runs WHERE id = ? AND owner_email = ?",
    ).bind(id, identity.email).first<{ id: string }>();
    if (!run) return c.json(errorResponse(c.req.path, "RUN_NOT_FOUND", "run not found or not owned"), 404);
    const rows = await c.env.DB.prepare(
      "SELECT * FROM run_events WHERE run_id = ? AND owner_email = ? ORDER BY ts ASC",
    ).bind(id, identity.email).all<RunEventRow>();
    return c.json(jsonResponse(c.req.path, { events: (rows.results ?? []).map(parseEvent) }));
  });

  app.post("/api/runs/:id/events", async (c) => {
    const runId = c.req.param("id");
    const body = (await c.req.json<AppendRunEventBody>().catch(() => ({}))) as AppendRunEventBody;
    if (!body.type?.trim()) return c.json(errorResponse(c.req.path, "BAD_EVENT_TYPE", "type is required"), 400);
    if (!body.actor?.id || !body.actor.kind || !body.actor.mode) {
      return c.json(errorResponse(c.req.path, "BAD_EVENT_ACTOR", "actor.id, actor.kind, and actor.mode are required"), 400);
    }
    try {
      const event = await appendOwnedRunEvent(c, runId, {
        event_id: body.event_id,
        ts: body.ts,
        actor: body.actor,
        type: body.type,
        data: body.data,
        evidence: body.evidence,
      });
      return c.json(jsonResponse(c.req.path, event, [
        { command: `GET /runs/${runId}`, description: "Open the Run Board" },
      ]), 201);
    } catch (error) {
      if (error instanceof RunReceiptNotFoundError) return c.json(errorResponse(c.req.path, "RUN_NOT_FOUND", error.message), 404);
      if (error instanceof RunReceiptTerminalError) return c.json(errorResponse(c.req.path, "RUN_TERMINAL", error.message), 409);
      throw error;
    }
  });

  // Notifications redesign (B-C2): clear a failed/terminal run from the stream.
  app.post("/api/runs/:id/dismiss", async (c) => {
    const identity = c.get("identity");
    const runId = c.req.param("id");
    const result = await c.env.DB.prepare(
      "UPDATE runs SET dismissed_at = datetime('now') WHERE id = ? AND owner_email = ? AND dismissed_at IS NULL",
    ).bind(runId, identity.email).run();
    if ((result.meta?.changes ?? 0) === 0) {
      // Idempotent: unknown run -> 404; already-dismissed -> ok:true no-op.
      const exists = await c.env.DB.prepare("SELECT 1 AS ok FROM runs WHERE id = ? AND owner_email = ?").bind(runId, identity.email).first<{ ok: number }>();
      if (!exists) return c.json(errorResponse(c.req.path, "RUN_NOT_FOUND", "run not found or not owned"), 404);
    }
    return c.json(jsonResponse(c.req.path, { runId, dismissed: true }));
  });

  // Clear all currently-listed dismissable runs (optionally scoped by status).
  app.post("/api/runs/dismiss-all", async (c) => {
    const identity = c.get("identity");
    const body = (await c.req.json<{ status?: RunStatus }>().catch(() => ({}))) as { status?: RunStatus };
    const status = body.status && ["open", "running", "completed", "failed", "aborted"].includes(body.status) ? body.status : null;
    const result = status
      ? await c.env.DB.prepare("UPDATE runs SET dismissed_at = datetime('now') WHERE owner_email = ? AND status = ? AND dismissed_at IS NULL").bind(identity.email, status).run()
      : await c.env.DB.prepare("UPDATE runs SET dismissed_at = datetime('now') WHERE owner_email = ? AND dismissed_at IS NULL").bind(identity.email).run();
    return c.json(jsonResponse(c.req.path, { dismissed: Number(result.meta?.changes ?? 0) }));
  });

  app.post("/api/runs/:id/stop", async (c) => {
    const identity = c.get("identity");
    const runId = c.req.param("id");
    const body = (await c.req.json<{ status?: RunStatus; reason?: string }>().catch(() => ({}))) as { status?: RunStatus; reason?: string };
    const status: RunStatus = body.status && ["completed", "failed", "aborted"].includes(body.status) ? body.status : "completed";
    const run = await c.env.DB.prepare(
      "SELECT status FROM runs WHERE id = ? AND owner_email = ?",
    ).bind(runId, identity.email).first<{ status: RunStatus }>();
    if (!run) return c.json(errorResponse(c.req.path, "RUN_NOT_FOUND", "run not found or not owned"), 404);
    if (["completed", "failed", "aborted"].includes(run.status)) {
      return c.json(errorResponse(c.req.path, "RUN_TERMINAL", "run is already terminal"), 409);
    }

    const result = await c.env.DB.prepare(
      "UPDATE runs SET status = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ? AND status NOT IN ('completed', 'failed', 'aborted')",
    ).bind(status, runId, identity.email).run();
    if (!result.success || (result.meta?.changes ?? 0) === 0) {
      return c.json(errorResponse(c.req.path, "RUN_TERMINAL", "run became terminal before this transition"), 409);
    }

    const stopEvent = {
      actor: { id: "agent:coordinator", kind: "coordinator", mode: "live" },
      type: `run.${status}`,
      data: { reason: body.reason ?? null },
    };
    await c.env.DB.prepare(
      "INSERT INTO run_events (run_id, event_id, owner_email, ts, actor_json, type, data_json, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
    ).bind(runId, runEventId(stopEvent.type), identity.email, nowIso(), JSON.stringify(stopEvent.actor), stopEvent.type, JSON.stringify(stopEvent.data)).run();

    return c.json(jsonResponse(c.req.path, { runId, status }));
  });

  app.get("/runs", async (c) => {
    const identity = c.get("identity");
    const { limit, status, invalidStatus } = parseRunListQuery(new URL(c.req.url));
    if (invalidStatus) return c.html(<Layout title="Runs · My Agent Experience" identityEmail={identity.email} buildId={c.env.CF_VERSION_METADATA?.id ?? undefined} theme={readThemeCookie(c)}><main class="min-h-dvh grid place-items-center p-6" data-runs-page><section class="max-w-xl rounded-2xl border border-line bg-bg-alt p-6"><h1 class="text-xl font-semibold text-fg">Unsupported run filter</h1><p class="mt-2 text-sm text-fg-mut">Status filter `{invalidStatus}` is not supported.</p><nav class="mt-4 flex flex-wrap gap-2" data-runs-next-actions><a class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:border-brand hover:text-brand" href="/">Back to Check-in</a><a class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:border-brand hover:text-brand" href="/runs">View all runs</a><a class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:border-brand hover:text-brand" href="/api/runs" data-runs-api-receipt-href="/api/runs">API receipt</a></nav></section></main></Layout>, 400);
    const [rows, countRows] = await Promise.all([
      status
        ? c.env.DB.prepare("SELECT id, status, title, task_summary, created_at, updated_at FROM runs WHERE owner_email = ? AND status = ? ORDER BY updated_at DESC LIMIT ?").bind(identity.email, status, limit).all<Pick<RunRow, "id" | "status" | "title" | "task_summary" | "created_at" | "updated_at">>()
        : c.env.DB.prepare("SELECT id, status, title, task_summary, created_at, updated_at FROM runs WHERE owner_email = ? ORDER BY updated_at DESC LIMIT ?").bind(identity.email, limit).all<Pick<RunRow, "id" | "status" | "title" | "task_summary" | "created_at" | "updated_at">>(),
      c.env.DB.prepare("SELECT status, COUNT(*) AS count FROM runs WHERE owner_email = ? GROUP BY status").bind(identity.email).all<{ status: RunStatus; count: number }>(),
    ]);
    const runs = rows.results ?? [];
    const apiReceiptHref = formatRenderedRunsApiReceiptHref(status);
    const statusCounts: Record<RunStatus, number> = { open: 0, running: 0, completed: 0, failed: 0, aborted: 0 };
    for (const row of countRows.results ?? []) if ((RUN_STATUSES as readonly string[]).includes(row.status)) statusCounts[row.status] = Number(row.count ?? 0);
    return c.html(
      <Layout title="Runs · My Agent Experience" identityEmail={identity.email} buildId={c.env.CF_VERSION_METADATA?.id ?? undefined} theme={readThemeCookie(c)}>
        <main class="min-h-dvh bg-bg text-fg" data-runs-page>
          <section class="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
            <header class="rounded-2xl border border-line bg-bg-alt p-5">
              <a class="text-xs font-semibold text-fg-mut hover:text-fg" href="/">← Back to Check-in</a>
              <h1 class="mt-3 text-3xl font-bold">Runs</h1>
              <p class="mt-1 text-sm text-fg-mut">{runs.length} shown{status ? ` · status: ${status}` : ""}</p>
              <div class="mt-4 flex flex-wrap gap-2" data-runs-status-summary>
                {RUN_STATUSES.map((runStatus) => <a class="rounded-xl border border-line px-3 py-2 text-xs text-fg-mut hover:border-brand hover:text-brand" href={`/runs?status=${runStatus}`}><strong class="text-fg">{statusCounts[runStatus]}</strong> {runStatus}</a>)}
              </div>
              <div class="mt-4 flex flex-wrap gap-2">
                {RUN_STATUSES.map((runStatus) => <a class={`rounded-full border px-3 py-1 text-xs font-semibold ${status === runStatus ? "border-brand bg-brand/10 text-brand" : "border-line text-fg-mut hover:text-fg"}`} href={`/runs?status=${runStatus}`}>{runStatus}</a>)}
                <a class="rounded-full border border-line px-3 py-1 text-xs font-semibold text-fg-mut hover:text-fg" href={apiReceiptHref} data-runs-api-receipt-href={apiReceiptHref}>API receipt</a>
              </div>
              <nav class="mt-3 flex flex-wrap gap-2" data-runs-next-actions>
                <a class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:border-brand hover:text-brand" href="/">Back to Check-in</a>
                <a class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:border-brand hover:text-brand" href="/runs">View all runs</a>
                <a class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:border-brand hover:text-brand" href={apiReceiptHref} data-runs-api-receipt-href={apiReceiptHref}>API receipt</a>
              </nav>
            </header>
            {runs.length ? <ol class="space-y-3">
              {runs.map((run) => <li class="rounded-2xl border border-line bg-bg-alt p-4" data-run-list-item={run.id}>
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 class="text-sm font-semibold text-fg">{run.title || run.id}</h2>
                    <p class="mt-1 text-sm leading-6 text-fg-mut">{run.task_summary}</p>
                  </div>
                  <span class={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${statusClass(run.status)}`}>{run.status}</span>
                </div>
                <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-mut">
                  <a class="rounded-full bg-brand px-3 py-1.5 font-bold text-white hover:opacity-90" href={`/runs/${run.id}`} data-run-receipt-href={`/runs/${run.id}`}>Open receipt</a>
                  <time>{run.updated_at}</time>
                  <code class="font-mono text-[10px]">{run.id}</code>
                </div>
              </li>)}
            </ol> : <section class="rounded-2xl border border-line bg-bg-alt p-6 text-sm text-fg-mut" data-runs-empty>
              <p>No runs match this view.</p>
              <div class="mt-4 flex flex-wrap gap-2">
                <a class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:border-brand hover:text-brand" href="/">Back to Check-in</a>
                <a class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:border-brand hover:text-brand" href="/runs">View all runs</a>
                <a class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:border-brand hover:text-brand" href={apiReceiptHref} data-runs-api-receipt-href={apiReceiptHref}>API receipt</a>
              </div>
            </section>}
          </section>
        </main>
      </Layout>,
    );
  });

  app.get("/runs/:id", async (c) => {
    const identity = c.get("identity");
    const runId = c.req.param("id");
    const run = await c.env.DB.prepare(
      "SELECT * FROM runs WHERE id = ? AND owner_email = ?",
    ).bind(runId, identity.email).first<RunRow>();
    if (!run) return c.html(<Layout title="Run not found · My Agent Experience" identityEmail={identity.email} buildId={c.env.CF_VERSION_METADATA?.id ?? undefined} theme={readThemeCookie(c)}><main class="min-h-dvh grid place-items-center p-6"><section class="max-w-xl rounded-2xl border border-line bg-bg-alt p-6"><h1 class="text-xl font-semibold text-fg">Run not found</h1><p class="mt-2 text-sm text-fg-mut">This receipt does not exist, or it is not owned by this Access identity.</p><a class="mt-4 inline-block text-brand" href="/">Back to Check-in</a></section></main></Layout>, 404);

    const rows = await c.env.DB.prepare(
      "SELECT * FROM run_events WHERE run_id = ? AND owner_email = ? ORDER BY ts ASC",
    ).bind(runId, identity.email).all<RunEventRow>();
    const events = (rows.results ?? []).map(parseEvent);
    const claims = claimSummary(events);
    const actors = Array.from(new Map(events.map((event) => [event.actor?.id ?? "unknown", event.actor])).entries()).filter(([, actor]) => actor);

    return c.html(
      <Layout title={`Run Receipt · ${runId}`} identityEmail={identity.email} buildId={c.env.CF_VERSION_METADATA?.id ?? undefined} theme={readThemeCookie(c)}>
        <main class="min-h-dvh bg-bg text-fg">
          <section class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
            <header class="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <a class="text-xs uppercase tracking-[0.22em] text-fg-mut hover:text-brand" href="/">my · ax</a>
                <h1 class="mt-3 text-2xl font-semibold tracking-tight sm:text-4xl">Run Receipt</h1>
                <p class="mt-2 max-w-3xl text-sm leading-6 text-fg-mut">{run.task_summary}</p>
              </div>
              <div class={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${statusClass(run.status)}`}>{run.status}</div>
            </header>

            <section class="grid gap-4 md:grid-cols-3">
              <div class="rounded-2xl border border-line bg-bg-alt p-4">
                <div class="text-xs uppercase tracking-[0.18em] text-fg-mut">Run id</div>
                <code class="mt-2 block break-all text-sm text-brand">{run.id}</code>
              </div>
              <div class="rounded-2xl border border-line bg-bg-alt p-4">
                <div class="text-xs uppercase tracking-[0.18em] text-fg-mut">Created</div>
                <div class="mt-2 font-mono text-sm">{run.created_at}</div>
              </div>
              <div class="rounded-2xl border border-line bg-bg-alt p-4">
                <div class="text-xs uppercase tracking-[0.18em] text-fg-mut">Events</div>
                <div class="mt-2 text-3xl font-semibold">{events.length}</div>
              </div>
            </section>

            <section class="rounded-2xl border border-line bg-bg-alt p-4">
              <h2 class="text-lg font-semibold">Claim gate</h2>
              <p class="mt-1 text-sm text-fg-mut">This board should only claim what the event trail supports.</p>
              <div class="mt-4 grid gap-3 md:grid-cols-3">
                {claims.map((claim) => (
                  <div class="rounded-xl border border-line bg-bg p-3">
                    <div class="text-sm font-medium">{claim.label}</div>
                    <div class={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs uppercase tracking-wide ${claim.status === "live" ? "border-good/30 bg-good/10 text-good" : "border-line text-fg-mut"}`}>{claim.status}</div>
                    <code class="mt-2 block break-all text-xs text-fg-mut">{claim.event}</code>
                  </div>
                ))}
              </div>
            </section>

            <section class="rounded-2xl border border-line bg-bg-alt p-4">
              <h2 class="text-lg font-semibold">Actors</h2>
              <div class="mt-4 flex flex-wrap gap-2">
                {actors.length ? actors.map(([id, actor]) => (
                  <span class="rounded-full border border-line bg-bg px-3 py-1 text-xs">{id} · {actor?.kind} · {actor?.mode}</span>
                )) : <span class="text-sm text-fg-mut">No actors yet.</span>}
              </div>
            </section>

            <section class="rounded-2xl border border-line bg-bg-alt p-4">
              <div class="flex items-baseline justify-between gap-4">
                <h2 class="text-lg font-semibold">Event trail</h2>
                <a class="text-xs text-brand" href={`/api/runs/${runId}/events`} data-run-events-receipt-href={`/api/runs/${runId}/events`}>raw JSON</a>
              </div>
              <ol class="mt-4 space-y-3">
                {events.map((event) => (
                  <li class="rounded-xl border border-line bg-bg p-3">
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                      <div>
                        <code class="text-sm text-brand">{event.type}</code>
                        <div class="mt-1 text-xs text-fg-mut">{event.actor?.id ?? "unknown actor"} · {event.actor?.kind ?? "unknown"} · {event.actor?.mode ?? "unknown"}</div>
                      </div>
                      <time class="font-mono text-xs text-fg-mut">{event.ts}</time>
                    </div>
                    <pre class="mt-3 max-h-64 overflow-auto rounded-lg border border-line bg-bg-alt p-3 text-xs text-fg-mut">{JSON.stringify(event.data ?? {}, null, 2)}</pre>
                  </li>
                ))}
              </ol>
            </section>
          </section>
        </main>
      </Layout>,
    );
  });
}

import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { ingestSpans, SPAN_INGEST_MAX, SPAN_SOURCES } from "../pi-engine/span-store";

export function registerSpanRoutes(app: Hono<AppEnv>) {
  app.post("/api/spans", async (c) => {
    const body = await c.req.json<{ source?: unknown; spans?: unknown }>().catch(() => null);
    const source = SPAN_SOURCES.find((known) => known === body?.source);
    if (!source || !Array.isArray(body?.spans)) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_SPANS", message: `body must be { source: ${SPAN_SOURCES.map((known) => `"${known}"`).join(" | ")}, spans: [...] }` }, next_actions: [] }, 400);
    if (body.spans.length > SPAN_INGEST_MAX) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "TOO_MANY_SPANS", message: `at most ${SPAN_INGEST_MAX} spans per request` }, next_actions: [] }, 413);
    const result = await ingestSpans(c.env.DB, c.get("identity").email, source, body.spans);
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result, next_actions: [] });
  });
}

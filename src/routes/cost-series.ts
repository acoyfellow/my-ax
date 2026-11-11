import { Effect } from "effect";
import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { readCostSummary, readCycleCostSeries } from "../cycle-costs-program";
import { findModel } from "../models";
import { databaseLayer } from "../effect/database";

export function registerCostSeriesRoutes(app: Hono<AppEnv>) {
  app.get("/api/cost-series", async (c) => {
    const command = "GET /api/cost-series";
    const session = c.req.query("session")?.trim();
    if (!session) {
      return c.json<ApiResponse>({ ok: false, command, error: { code: "InvalidInput", message: "session is required" }, next_actions: [] }, 400);
    }
    const series = await Effect.runPromise(
      readCycleCostSeries(c.get("identity").email, session).pipe(Effect.provide(databaseLayer(c.env.DB))),
    );
    return c.json<ApiResponse>({ ok: true, command, result: { session, series }, next_actions: [] });
  });

  app.get("/api/cost-summary", async (c) => {
    const command = "GET /api/cost-summary";
    const summary = await Effect.runPromise(
      readCostSummary(c.get("identity").email, (model) => findModel(model)?.label).pipe(Effect.provide(databaseLayer(c.env.DB))),
    );
    return c.json<ApiResponse>({ ok: true, command, result: summary, next_actions: [] });
  });
}

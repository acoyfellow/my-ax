import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { readCycleCostSeries } from "../cycle-costs";

export function registerCostSeriesRoutes(app: Hono<AppEnv>) {
  app.get("/api/cost-series", async (c) => {
    const command = "GET /api/cost-series";
    const session = c.req.query("session")?.trim();
    if (!session) {
      return c.json<ApiResponse>({ ok: false, command, error: { code: "InvalidInput", message: "session is required" }, next_actions: [] }, 400);
    }
    const series = await readCycleCostSeries(c.env, c.get("identity").email, session);
    return c.json<ApiResponse>({ ok: true, command, result: { session, series }, next_actions: [] });
  });
}

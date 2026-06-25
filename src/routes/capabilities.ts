import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { createCapabilityBundle, runCapabilityReviewDemo } from "../capability-review";

export function registerCapabilityRoutes(app: Hono<AppEnv>) {
  app.post("/api/capabilities/demo", async (c) => {
    const identity = c.get("identity");
    const body = await c.req.json().catch(() => ({})) as { urls?: unknown; task?: unknown };
    const urls = Array.isArray(body.urls) ? body.urls.filter((url): url is string => typeof url === "string" && url.trim().length > 0) : [];
    if (!urls.length) {
      return c.json<ApiResponse>({
        ok: false,
        command: "POST /api/capabilities/demo",
        error: { code: "BAD_REQUEST", message: "Provide at least one URL." },
        next_actions: [],
      }, 400);
    }
    try {
      const bundle = createCapabilityBundle({ principal: identity.email, urls, task: typeof body.task === "string" ? body.task : "Scoped capability review" });
      const proof = runCapabilityReviewDemo(bundle);
      return c.json<ApiResponse>({
        ok: true,
        command: "POST /api/capabilities/demo",
        result: { bundle, proof },
        next_actions: [],
      });
    } catch (error) {
      return c.json<ApiResponse>({
        ok: false,
        command: "POST /api/capabilities/demo",
        error: { code: "UNSUPPORTED_URL", message: error instanceof Error ? error.message : String(error) },
        next_actions: [],
      }, 400);
    }
  });
}

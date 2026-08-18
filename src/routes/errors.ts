import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { fileOwnerErrorIssue } from "../error-issue";

export function registerErrorRoutes(app: Hono<AppEnv>) {
  app.post("/api/errors", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const report = {
      ...(typeof body === "object" && body ? body : {}),
      origin: "client",
      versionId: c.env.CF_VERSION_METADATA?.id,
    };
    const result = await fileOwnerErrorIssue(c.env, c.get("identity").email, report);
    if ("error" in result) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_ERROR_REPORT", message: result.error }, next_actions: [] }, 400);
    }
    if ("skipped" in result) {
      return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { filed: false, reason: result.skipped }, next_actions: [] });
    }
    return c.json<ApiResponse>({
      ok: true,
      command: c.req.path,
      result: { filed: result.created, number: result.number, url: result.url, fingerprint: result.fingerprint },
      next_actions: result.url ? [{ command: "Open issue", description: result.url }] : [],
    }, result.created ? 201 : 200);
  });
}

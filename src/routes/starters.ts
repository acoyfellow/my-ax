// routes/starters.ts — owner-editable conversation starters.
//
// GET  /api/starters       -> the owner's starters (defaults if unset)
// PUT  /api/starters {starters:[{title,hint?,prompt}]} -> replace + return
//
// Owner-scoped and fail-closed via the shared owner_preferences store. Both the
// Settings UI and the agent's manage_starters tool go through this store.

import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { getConversationStarters, setConversationStarters } from "../conversation-starters";

export function registerStarterRoutes(app: Hono<AppEnv>) {
  app.get("/api/starters", async (c) => {
    const command = "GET /api/starters";
    try {
      const starters = await getConversationStarters(c.env, c.get("identity").email);
      return c.json<ApiResponse>({ ok: true, command, result: { starters }, next_actions: [] });
    } catch (error) {
      return c.json<ApiResponse>({ ok: false, command, error: { code: "DBError", message: error instanceof Error ? error.message : String(error) }, next_actions: [] }, 500);
    }
  });

  app.put("/api/starters", async (c) => {
    const command = "PUT /api/starters";
    const body = await c.req.json<{ starters?: unknown }>().catch(() => ({} as { starters?: unknown }));
    try {
      const starters = await setConversationStarters(c.env, c.get("identity").email, body.starters);
      return c.json<ApiResponse>({ ok: true, command, result: { starters }, next_actions: [] });
    } catch (error) {
      return c.json<ApiResponse>({ ok: false, command, error: { code: "DBError", message: error instanceof Error ? error.message : String(error) }, next_actions: [] }, 500);
    }
  });
}

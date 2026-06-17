// routes/models.ts — model catalog endpoints.
//
//   GET /api/models           curated catalog from src/models.ts

import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { availableModels } from "../models";
import type { ApiResponse } from "../types";

export function registerModelRoutes(app: Hono<AppEnv>) {
  // Curated frontier catalog. Provider/gateway routing is deliberately not
  // exposed in the product surface; operators control upstream access.
  app.get("/api/models", async (c) => {
    const models = availableModels(c.env);
    return c.json<ApiResponse>({
      ok: true,
      command: c.req.path,
      result: {
        object: "list",
        data: models.map((m) => ({
          id: m.id,
          object: "model",
          owned_by: m.owned_by,
          available: true,
          // Non-OpenAI fields the UI uses:
          reasoning: m.reasoning,
          tools: m.tools,
          vision: m.vision,
          context: m.context,
          label: m.label,
        })),
      },
      next_actions: [],
    });
  });
}

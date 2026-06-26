// routes/models.ts — model catalog endpoints.
//
//   GET /api/models             curated catalog from src/models.ts
//   GET /api/models/catalog?q=  same catalog, filtered for Settings search

import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { availableModels, type ModelEntry } from "../models";
import type { ApiResponse } from "../types";

function serializeModel(m: ModelEntry) {
  return {
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
  };
}

function catalogResponse(path: string, models: ModelEntry[]): ApiResponse {
  return {
    ok: true,
    command: path,
    result: {
      object: "list",
      data: models.map(serializeModel),
    },
    next_actions: [],
  };
}

export function registerModelRoutes(app: Hono<AppEnv>) {
  // Curated catalog. Provider/gateway routing is deliberately not exposed in
  // the product surface; every row is meant to be selectable by this engine.
  app.get("/api/models", async (c) => c.json<ApiResponse>(catalogResponse(c.req.path, availableModels(c.env))));

  app.get("/api/models/catalog", async (c) => {
    const q = c.req.query("q")?.trim().toLowerCase() ?? "";
    const models = q
      ? availableModels(c.env).filter((m) => `${m.label} ${m.id} ${m.owned_by}`.toLowerCase().includes(q))
      : availableModels(c.env);
    return c.json<ApiResponse>(catalogResponse(c.req.path, models));
  });
}

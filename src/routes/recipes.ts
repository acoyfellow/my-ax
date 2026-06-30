import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { getSessionAgent } from "../agent-stub";
import { publicRecipe, SavedRecipeError, SavedRecipeService, validateRecipeRunInput } from "../saved-recipes";
import { requireOwnedSession } from "../session-ownership";

function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  return c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
}

function service(c: Context<AppEnv>) {
  return new SavedRecipeService(c.env, c.get("identity").email);
}

function failure(c: Context<AppEnv>, command: string, error: unknown) {
  const known = error instanceof SavedRecipeError;
  const code = known ? error.code : "InternalError";
  const status: ContentfulStatusCode = code === "InvalidInput" ? 400 : code === "NotFound" ? 404 : code === "Conflict" ? 409 : 500;
  return c.json<ApiResponse>({ ok: false, command, error: { code, message: error instanceof Error ? error.message : String(error) }, next_actions: [] }, status);
}

function ok(c: Context<AppEnv>, command: string, result: unknown, status: ContentfulStatusCode = 200) {
  return c.json<ApiResponse>({ ok: true, command, result, next_actions: [] }, status);
}

export function registerRecipeRoutes(app: Hono<AppEnv>) {
  app.get("/api/recipes", async (c) => {
    const command = "GET /api/recipes";
    try { return ok(c, command, { recipes: await service(c).list() }); }
    catch (error) { return failure(c, command, error); }
  });

  app.post("/api/recipes", async (c) => {
    const command = "POST /api/recipes";
    try { return ok(c, command, { recipe: await service(c).create(await body(c)) }, 201); }
    catch (error) { return failure(c, command, error); }
  });

  app.get("/api/recipes/:id", async (c) => {
    const command = `GET /api/recipes/${c.req.param("id")}`;
    try {
      const row = await service(c).get(c.req.param("id"));
      return ok(c, command, { recipe: { ...publicRecipe(row), code: row.code } });
    }
    catch (error) { return failure(c, command, error); }
  });

  app.get("/api/recipes/:id/approval", async (c) => {
    const command = `GET /api/recipes/${c.req.param("id")}/approval`;
    try {
      const row = await service(c).get(c.req.param("id"));
      return ok(c, command, { recipe: { ...publicRecipe(row), code: row.code }, actions: ["approve", "reject"] });
    }
    catch (error) { return failure(c, command, error); }
  });

  app.post("/api/recipes/:id/approval", async (c) => {
    const command = `POST /api/recipes/${c.req.param("id")}/approval`;
    try {
      const request = await body(c);
      const action = request.action === "reject" ? "reject" : request.action === "approve" ? "approve" : "";
      if (!action) throw new SavedRecipeError("InvalidInput", "action must be approve or reject");
      const recipe = await service(c).update(c.req.param("id"), { status: action === "approve" ? "enabled" : "disabled" });
      return ok(c, command, { recipe, action });
    }
    catch (error) { return failure(c, command, error); }
  });

  app.patch("/api/recipes/:id", async (c) => {
    const command = `PATCH /api/recipes/${c.req.param("id")}`;
    try { return ok(c, command, { recipe: await service(c).update(c.req.param("id"), await body(c)) }); }
    catch (error) { return failure(c, command, error); }
  });

  app.delete("/api/recipes/:id", async (c) => {
    const command = `DELETE /api/recipes/${c.req.param("id")}`;
    try { return ok(c, command, await service(c).delete(c.req.param("id"))); }
    catch (error) { return failure(c, command, error); }
  });

  app.post("/api/recipes/:id/run", async (c) => {
    const command = `POST /api/recipes/${c.req.param("id")}/run`;
    try {
      const request = await body(c);
      const sessionId = typeof request.sessionId === "string" ? request.sessionId : "";
      if (!sessionId) throw new SavedRecipeError("InvalidInput", "sessionId is required");
      const input = typeof request.input === "object" && request.input ? request.input as Record<string, unknown> : {};
      const row = await service(c).get(c.req.param("id"));
      validateRecipeRunInput(input, JSON.parse(row.input_schema_json));
      if (!await requireOwnedSession(c.env, sessionId, c.get("identity").email)) throw new SavedRecipeError("NotFound", "session not found or not owned");
      const agent = await getSessionAgent(c.env, c.get("identity").email, sessionId);
      const result = await agent.runSavedRecipe({ recipeId: c.req.param("id"), input });
      return ok(c, command, result, 202);
    } catch (error) {
      return failure(c, command, error);
    }
  });
}

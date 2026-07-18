import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { getSessionAgent } from "../agent-stub";
import { publicRecipe, SavedRecipeError, SavedRecipeService, validateRecipeRunInput } from "../saved-recipes";
import { projectSavedRecipe } from "../cm-snippets";
import { reusableToolApprovalMode, setReusableToolApprovalMode } from "../reusable-tool-preferences";
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

  app.get("/api/recipes/preferences", async (c) => {
    const command = "GET /api/recipes/preferences";
    try {
      return ok(c, command, { approvalMode: await reusableToolApprovalMode(c.env, c.get("identity").email) });
    } catch (error) { return failure(c, command, error); }
  });

  app.post("/api/recipes/preferences", async (c) => {
    const command = "POST /api/recipes/preferences";
    try {
      const request = await body(c);
      if (request.approvalMode !== "review" && request.approvalMode !== "auto") {
        throw new SavedRecipeError("InvalidInput", "approvalMode must be review or auto");
      }
      return ok(c, command, {
        approvalMode: await setReusableToolApprovalMode(c.env, c.get("identity").email, request.approvalMode),
      });
    } catch (error) { return failure(c, command, error); }
  });

  app.post("/api/recipes/by-name/approval", async (c) => {
    const command = "POST /api/recipes/by-name/approval";
    try {
      const request = await body(c);
      const action = request.action === "reject" ? "reject" : request.action === "approve" ? "approve" : "";
      const name = typeof request.name === "string" ? request.name : "";
      const sourceCode = typeof request.sourceCode === "string" ? request.sourceCode.trim() : "";
      if (!action) throw new SavedRecipeError("InvalidInput", "action must be approve or reject");
      if (!sourceCode) throw new SavedRecipeError("InvalidInput", "sourceCode is required");
      // The card becomes visible as soon as work_code returns, while promotion
      // is finalized at the end of the assistant turn. Bridge that brief race
      // so an owner can click the button immediately instead of seeing a false
      // "not found" error and having to try again.
      let existing;
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          existing = await service(c).getByName(name);
          break;
        } catch (error) {
          if (!(error instanceof SavedRecipeError) || error.code !== "NotFound" || attempt === 9) throw error;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (!existing) {
        // A card can only be missing its saved row if promotion refused to
        // persist it. The dominant cause is host-bound machine/terrarium code,
        // which is inline-only by policy. Give the owner an actionable reason
        // instead of a bare "not found" they cannot resolve by retrying.
        throw new SavedRecipeError(
          "NotFound",
          "This reusable tool was not saved and cannot be enabled. Machine- or Terrarium-bound tools run inline only and are never persisted as reusable tools.",
        );
      }
      if (existing.code.trim() !== sourceCode) {
        throw new SavedRecipeError("Conflict", "This card no longer matches the saved reusable tool. Open Reusable tools to review the current version.");
      }
      const recipe = await service(c).update(existing.id, { status: action === "approve" ? "enabled" : "disabled" });
      if (action === "approve") await projectSavedRecipe(c.env, await service(c).get(existing.id));
      return ok(c, command, { recipe, action });
    } catch (error) { return failure(c, command, error); }
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
      if (action === "approve") await projectSavedRecipe(c.env, await service(c).get(c.req.param("id")));
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

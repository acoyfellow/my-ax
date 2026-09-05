import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { getOwnerInstructions, resetOwnerInstructions, setOwnerInstructions } from "../owner-instructions";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerInstructionRoutes(app: Hono<AppEnv>) {
  app.get("/api/instructions", async (c) => {
    const command = "GET /api/instructions";
    try {
      const instructions = await getOwnerInstructions(c.env, c.get("identity").email);
      return c.json<ApiResponse>({ ok: true, command, result: { instructions }, next_actions: [] });
    } catch (error) {
      return c.json<ApiResponse>({ ok: false, command, error: { code: "DBError", message: errorMessage(error) }, next_actions: [] }, 500);
    }
  });

  app.put("/api/instructions", async (c) => {
    const command = "PUT /api/instructions";
    const body = await c.req.json<{ instructions?: unknown }>().catch(() => null);
    if (!body || typeof body.instructions !== "string") {
      return c.json<ApiResponse>({ ok: false, command, error: { code: "InvalidInput", message: "instructions must be a string" }, next_actions: [] }, 400);
    }
    try {
      const instructions = await setOwnerInstructions(c.env, c.get("identity").email, body.instructions);
      return c.json<ApiResponse>({ ok: true, command, result: { instructions }, next_actions: [] });
    } catch (error) {
      const invalid = error instanceof TypeError || error instanceof RangeError;
      return c.json<ApiResponse>({ ok: false, command, error: { code: invalid ? "InvalidInput" : "DBError", message: errorMessage(error) }, next_actions: [] }, invalid ? 400 : 500);
    }
  });

  app.post("/api/instructions/reset", async (c) => {
    const command = "POST /api/instructions/reset";
    try {
      const instructions = await resetOwnerInstructions(c.env, c.get("identity").email);
      return c.json<ApiResponse>({ ok: true, command, result: { instructions }, next_actions: [] });
    } catch (error) {
      return c.json<ApiResponse>({ ok: false, command, error: { code: "DBError", message: errorMessage(error) }, next_actions: [] }, 500);
    }
  });
}

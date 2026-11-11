import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { ownerDeskGet, ownerDeskRemove, ownerDeskUpsert } from "./desk";
import { parseVoiceDeskRequest, planVoiceDeskAction } from "../voice-command";

export function registerVoiceRoutes(app: Hono<AppEnv>) {
  app.post("/api/voice/desk", async (c) => {
    const command = "POST /api/voice/desk";
    const request = parseVoiceDeskRequest(await c.req.json().catch(() => null));
    if (!request) return c.json<ApiResponse>({ ok: false, command, error: { code: "BAD_VOICE_COMMAND", message: "kind must be approve or dismiss and card a number from 1 to 99" }, next_actions: [] }, 400);
    const email = c.get("identity").email;
    const board = await ownerDeskGet(c.env, email);
    const plan = planVoiceDeskAction(board, request.action, request.confirmed);
    if (!plan.ok) return c.json<ApiResponse>({ ok: false, command, error: { code: plan.code, message: plan.message }, next_actions: [] }, plan.code === "NOT_CONFIRMED" ? 428 : 409);
    const next = "remove" in plan.change
      ? await ownerDeskRemove(c.env, email, plan.cardId)
      : await ownerDeskUpsert(c.env, email, { ...board.cards.find((card) => card.id === plan.cardId), status: plan.change.status });
    return c.json<ApiResponse>({ ok: true, command, result: { board: next, receipt: { heard: request.heard, action: request.action, cardId: plan.cardId, title: plan.title } }, next_actions: [] });
  });
}

import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { ownerDeskGet, ownerDeskRemove, ownerDeskUpsert } from "./desk";
import { getAgentByName } from "agents";
import * as rpc from "../rpc/contract";
import { sanitizeLayerIds } from "../model-layers";
import { resolveOwnedVoiceTarget } from "../voice-session-ownership";
import { parseVoiceDeskRequest, planVoiceDeskAction } from "../voice-command";

export function registerVoiceRoutes(app: Hono<AppEnv>) {
  app.post("/api/voice/layers", async (c) => {
    const command = "POST /api/voice/layers";
    const body = (await c.req.json().catch(() => null)) as { sessionId?: unknown; layers?: unknown } | null;
    if (!body || typeof body.sessionId !== "string" || !body.sessionId || !Array.isArray(body.layers)) {
      return c.json<ApiResponse>({ ok: false, command, error: { code: "BAD_VOICE_LAYERS", message: "sessionId and layers are required" }, next_actions: [] }, 400);
    }
    const layers = sanitizeLayerIds(body.layers);
    try {
      const voiceName = await resolveOwnedVoiceTarget(c.env.DB, c.get("identity"), body.sessionId);
      await rpc.command("VoiceThinkAgent.setLayers", async () => (await getAgentByName(c.env.VoiceThinkAgent, voiceName)).setLayers(layers));
    } catch {
      return c.json<ApiResponse>({ ok: false, command, error: { code: "NOT_FOUND", message: "Session not found or not owned" }, next_actions: [] }, 404);
    }
    return c.json<ApiResponse>({ ok: true, command, result: { layers }, next_actions: [] });
  });

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

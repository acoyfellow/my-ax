import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { DESK_PREFERENCE_KEY, emptyDeskBoard, parseDeskBoard, upsertDeskCard, type DeskBoard } from "../desk-board";

async function readBoard(env: AppEnv["Bindings"], email: string): Promise<DeskBoard> {
  const row = await env.DB.prepare("SELECT value_json FROM owner_preferences WHERE owner_email = ? AND preference_key = ?")
    .bind(email, DESK_PREFERENCE_KEY).first<{ value_json: string }>();
  if (!row?.value_json) return emptyDeskBoard();
  try { return parseDeskBoard(JSON.parse(row.value_json)); } catch { return emptyDeskBoard(); }
}

async function writeBoard(env: AppEnv["Bindings"], email: string, board: DeskBoard): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO owner_preferences(owner_email, preference_key, value_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner_email, preference_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
    .bind(email, DESK_PREFERENCE_KEY, JSON.stringify(board), now, now).run();
}

export async function ownerDeskGet(env: AppEnv["Bindings"], email: string): Promise<DeskBoard> {
  return readBoard(env, email.toLowerCase());
}

export async function ownerDeskUpsert(env: AppEnv["Bindings"], email: string, card: unknown): Promise<DeskBoard> {
  const owner = email.toLowerCase();
  const next = upsertDeskCard(await readBoard(env, owner), card);
  await writeBoard(env, owner, next);
  return next;
}

export function registerDeskRoutes(app: Hono<AppEnv>) {
  app.get("/api/desk", async (c) => {
    const board = await ownerDeskGet(c.env, c.get("identity").email);
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: board, next_actions: [] });
  });
  app.put("/api/desk", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const board = await ownerDeskUpsert(c.env, c.get("identity").email, body);
      return c.json<ApiResponse>({ ok: true, command: c.req.path, result: board, next_actions: [] });
    } catch (error) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_CARD", message: error instanceof Error ? error.message : "invalid desk card" }, next_actions: [] }, 400);
    }
  });
}

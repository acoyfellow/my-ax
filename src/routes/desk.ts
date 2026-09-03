import { getAgentByName } from "agents";
import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { DESK_PREFERENCE_KEY, emptyDeskBoard, markDeskCardReplied, parseDeskBoard, prepareDeskCardReply, upsertDeskCard, type DeskBoard } from "../desk-board";
import { writeWithCompareAndSet } from "../desk-write";
import { DESK_APP_PREFERENCE_KEY, applyDeskAppWrite, emptyDeskApp, parseDeskApp, type DeskApp } from "../desk-app";
import { describePromotion, promotionConfirmed, type ArtifactSummary, type PromotionPreview } from "../desk-promote";
import { getOwnedArtifactRow } from "../artifacts";
import { getSessionAgent } from "../agent-stub";
import { requireOwnedSession } from "../session-ownership";

async function readVersionedPreference<T>(
  env: AppEnv["Bindings"],
  email: string,
  key: string,
  parse: (raw: unknown) => T,
  fallback: () => T,
): Promise<{ value: T; version: string | null }> {
  const row = await env.DB.prepare("SELECT value_json, updated_at FROM owner_preferences WHERE owner_email = ? AND preference_key = ?")
    .bind(email, key).first<{ value_json: string; updated_at: string }>();
  if (!row?.value_json) return { value: fallback(), version: null };
  let value: T;
  try { value = parse(JSON.parse(row.value_json)); } catch { value = fallback(); }
  return { value, version: row.updated_at ?? null };
}

async function compareAndSetPreference(
  env: AppEnv["Bindings"],
  email: string,
  key: string,
  value: unknown,
  expectedVersion: string | null,
): Promise<boolean> {
  const now = new Date().toISOString();
  const payload = JSON.stringify(value);
  if (expectedVersion === null) {
    const inserted = await env.DB.prepare(`INSERT INTO owner_preferences(owner_email, preference_key, value_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_email, preference_key) DO NOTHING`)
      .bind(email, key, payload, now, now).run();
    return (inserted.meta?.changes ?? 0) > 0;
  }
  const updated = await env.DB.prepare(`UPDATE owner_preferences SET value_json = ?, updated_at = ?
    WHERE owner_email = ? AND preference_key = ? AND updated_at = ?`)
    .bind(payload, now, email, key, expectedVersion).run();
  return (updated.meta?.changes ?? 0) > 0;
}

export async function ownerDeskAppGet(env: AppEnv["Bindings"], email: string): Promise<DeskApp> {
  const read = await readVersionedPreference(env, email.toLowerCase(), DESK_APP_PREFERENCE_KEY, parseDeskApp, emptyDeskApp);
  return read.value;
}

export async function ownerDeskPromotionPreview(
  env: AppEnv["Bindings"],
  identity: { email: string },
  artifactId: string,
): Promise<PromotionPreview> {
  const incoming = await getOwnedArtifactRow(env as never, identity as never, artifactId);
  if (!incoming) throw new Error("that artifact does not exist, or it is not yours");
  const current = await ownerDeskAppGet(env, identity.email);
  let replaced: ArtifactSummary | null = null;
  if (current.artifactId) {
    const row = await getOwnedArtifactRow(env as never, identity as never, current.artifactId);
    replaced = { id: current.artifactId, title: row?.title ?? "an app that is no longer in your library" };
  }
  return describePromotion({ id: incoming.id, title: incoming.title }, replaced);
}

export async function ownerDeskPromote(
  env: AppEnv["Bindings"],
  identity: { email: string },
  artifactId: string,
  acknowledgedReplacedId: string | null,
): Promise<{ app: DeskApp; preview: PromotionPreview }> {
  const preview = await ownerDeskPromotionPreview(env, identity, artifactId);
  if (!promotionConfirmed(preview, acknowledgedReplacedId)) {
    throw new Error(`${preview.summary} Confirm by sending replacing: "${preview.replaces?.id}".`);
  }
  const app = await ownerDeskAppWrite(env, identity.email, { artifactId }, identity.email);
  return { app, preview };
}

export async function ownerDeskAppWrite(env: AppEnv["Bindings"], email: string, incoming: unknown, author?: string): Promise<DeskApp> {
  const owner = email.toLowerCase();
  applyDeskAppWrite(emptyDeskApp(), incoming, { author: author ?? null });
  const written = await writeWithCompareAndSet<DeskApp>(
    {
      read: () => readVersionedPreference(env, owner, DESK_APP_PREFERENCE_KEY, parseDeskApp, emptyDeskApp),
      compareAndSet: (next, expectedVersion) => compareAndSetPreference(env, owner, DESK_APP_PREFERENCE_KEY, next, expectedVersion),
    },
    (current) => applyDeskAppWrite(current, incoming, { author: author ?? null }),
  );
  await broadcastDeskApp(env, owner, written.value);
  return written.value;
}

async function broadcastDeskApp(env: AppEnv["Bindings"], email: string, app: DeskApp): Promise<void> {
  const owner = email.toLowerCase();
  const rows = await env.DB.prepare(
    "SELECT id FROM sessions WHERE owner_email = ? AND status != 'archived' ORDER BY updated_at DESC LIMIT 40",
  ).bind(owner).all<{ id: string }>();
  const parent = await getAgentByName(env.USER_AGENT, owner);
  await parent.broadcastDeskApp((rows.results ?? []).map((row) => row.id), app);
}

async function readBoard(env: AppEnv["Bindings"], email: string): Promise<DeskBoard> {
  const row = await env.DB.prepare("SELECT value_json FROM owner_preferences WHERE owner_email = ? AND preference_key = ?")
    .bind(email, DESK_PREFERENCE_KEY).first<{ value_json: string }>();
  if (!row?.value_json) return emptyDeskBoard();
  try { return parseDeskBoard(JSON.parse(row.value_json)); } catch { return emptyDeskBoard(); }
}

async function readVersionedBoard(env: AppEnv["Bindings"], email: string): Promise<{ value: DeskBoard; version: string | null }> {
  const row = await env.DB.prepare("SELECT value_json, updated_at FROM owner_preferences WHERE owner_email = ? AND preference_key = ?")
    .bind(email, DESK_PREFERENCE_KEY).first<{ value_json: string; updated_at: string }>();
  if (!row?.value_json) return { value: emptyDeskBoard(), version: null };
  let value: DeskBoard;
  try { value = parseDeskBoard(JSON.parse(row.value_json)); } catch { value = emptyDeskBoard(); }
  return { value, version: row.updated_at ?? null };
}

async function compareAndSetBoard(env: AppEnv["Bindings"], email: string, board: DeskBoard, expectedVersion: string | null): Promise<boolean> {
  const now = new Date().toISOString();
  const payload = JSON.stringify(board);
  if (expectedVersion === null) {
    const inserted = await env.DB.prepare(`INSERT INTO owner_preferences(owner_email, preference_key, value_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_email, preference_key) DO NOTHING`)
      .bind(email, DESK_PREFERENCE_KEY, payload, now, now).run();
    return (inserted.meta?.changes ?? 0) > 0;
  }
  const updated = await env.DB.prepare(`UPDATE owner_preferences SET value_json = ?, updated_at = ?
    WHERE owner_email = ? AND preference_key = ? AND updated_at = ?`)
    .bind(payload, now, email, DESK_PREFERENCE_KEY, expectedVersion).run();
  return (updated.meta?.changes ?? 0) > 0;
}

async function broadcastBoard(env: AppEnv["Bindings"], email: string, board: DeskBoard): Promise<void> {
  const owner = email.toLowerCase();
  const rows = await env.DB.prepare(
    "SELECT id FROM sessions WHERE owner_email = ? AND status != 'archived' ORDER BY updated_at DESC LIMIT 40",
  ).bind(owner).all<{ id: string }>();
  const parent = await getAgentByName(env.USER_AGENT, owner);
  await parent.broadcastDeskBoard((rows.results ?? []).map((row) => row.id), board);
}

async function writeBoard(env: AppEnv["Bindings"], email: string, board: DeskBoard): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO owner_preferences(owner_email, preference_key, value_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner_email, preference_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
    .bind(email, DESK_PREFERENCE_KEY, JSON.stringify(board), now, now).run();
  const owner = email.toLowerCase();
  const rows = await env.DB.prepare(
    "SELECT id FROM sessions WHERE owner_email = ? AND status != 'archived' ORDER BY updated_at DESC LIMIT 40",
  ).bind(owner).all<{ id: string }>();
  const parent = await getAgentByName(env.USER_AGENT, owner);
  await parent.broadcastDeskBoard((rows.results ?? []).map((row) => row.id), board);
}

export async function ownerDeskGet(env: AppEnv["Bindings"], email: string): Promise<DeskBoard> {
  return readBoard(env, email.toLowerCase());
}

export async function ownerDeskUpsert(env: AppEnv["Bindings"], email: string, card: unknown): Promise<DeskBoard> {
  const owner = email.toLowerCase();
  upsertDeskCard(emptyDeskBoard(), card);
  const written = await writeWithCompareAndSet<DeskBoard>(
    {
      read: () => readVersionedBoard(env, owner),
      compareAndSet: (next, expectedVersion) => compareAndSetBoard(env, owner, next, expectedVersion),
    },
    (current) => upsertDeskCard(current, card),
  );
  await broadcastBoard(env, owner, written.value);
  return written.value;
}

export async function ownerDeskReply(
  env: AppEnv["Bindings"],
  identity: AppEnv["Variables"]["identity"],
  cardId: string,
  response: unknown,
): Promise<DeskBoard> {
  const owner = identity.email.toLowerCase();
  const current = await readVersionedBoard(env, owner);
  const reply = prepareDeskCardReply(current.value, cardId, response);
  if (!(await requireOwnedSession(env, reply.originSessionId, owner))) throw new Error("the originating conversation is unavailable");
  const agent = await getSessionAgent(env, owner, reply.originSessionId);
  await agent.seedIdentity(identity);
  await agent.injectUserMessage({ content: reply.content, clientMsgId: reply.clientMsgId });
  await env.DB.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ? AND owner_email = ?")
    .bind(reply.originSessionId, owner).run();
  const written = await writeWithCompareAndSet<DeskBoard>(
    {
      read: () => readVersionedBoard(env, owner),
      compareAndSet: (next, expectedVersion) => compareAndSetBoard(env, owner, next, expectedVersion),
    },
    (board) => markDeskCardReplied(board, reply),
  );
  await broadcastBoard(env, owner, written.value);
  return written.value;
}

export async function ownerDeskClear(env: AppEnv["Bindings"], email: string): Promise<DeskBoard> {
  const next = emptyDeskBoard();
  await writeBoard(env, email.toLowerCase(), next);
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
  app.post("/api/desk/:id/reply", async (c) => {
    const body: { response?: unknown } = await c.req.json<{ response?: unknown }>().catch(() => ({} as { response?: unknown }));
    try {
      const board = await ownerDeskReply(c.env, c.get("identity"), c.req.param("id"), body.response);
      return c.json<ApiResponse>({ ok: true, command: c.req.path, result: board, next_actions: [] });
    } catch (error) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_REPLY", message: error instanceof Error ? error.message : "cannot send desk reply" }, next_actions: [] }, 400);
    }
  });
  app.get("/api/desk/app", async (c) => {
    const app_ = await ownerDeskAppGet(c.env, c.get("identity").email);
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: app_, next_actions: [] });
  });
  app.get("/api/desk/app/promotion-preview", async (c) => {
    const artifactId = c.req.query("artifactId") ?? "";
    try {
      const preview = await ownerDeskPromotionPreview(c.env, c.get("identity"), artifactId);
      return c.json<ApiResponse>({ ok: true, command: c.req.path, result: preview, next_actions: [] });
    } catch (error) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_PROMOTION", message: error instanceof Error ? error.message : "cannot preview" }, next_actions: [] }, 400);
    }
  });
  app.post("/api/desk/app/promote", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { artifactId?: unknown; replacing?: unknown };
    try {
      const artifactId = typeof body.artifactId === "string" ? body.artifactId : "";
      const replacing = typeof body.replacing === "string" ? body.replacing : null;
      const { app: app_, preview } = await ownerDeskPromote(c.env, c.get("identity"), artifactId, replacing);
      return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { app: app_, promoted: preview }, next_actions: [] });
    } catch (error) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_PROMOTION", message: error instanceof Error ? error.message : "cannot promote" }, next_actions: [] }, 400);
    }
  });
  app.put("/api/desk/app", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const identity = c.get("identity");
      const author = typeof (body as { updatedBy?: unknown }).updatedBy === "string" ? (body as { updatedBy: string }).updatedBy : identity.email;
      const app_ = await ownerDeskAppWrite(c.env, identity.email, body, author);
      return c.json<ApiResponse>({ ok: true, command: c.req.path, result: app_, next_actions: [] });
    } catch (error) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_DESK_WRITE", message: error instanceof Error ? error.message : "invalid desk write" }, next_actions: [] }, 400);
    }
  });
  app.delete("/api/desk", async (c) => {
    const board = await ownerDeskClear(c.env, c.get("identity").email);
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: board, next_actions: [] });
  });
}

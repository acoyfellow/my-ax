import type { Hono } from "hono";
import { getAgentByName } from "agents-pi";
import type { AppEnv } from "../app-env";
import type { PiChatAgent } from "./pi-chat-agent";
import { PI_ENGINE_MODEL_CHOICES } from "./gateway-models";
import { parseForkPoint } from "./fork";
import { copyWorkspaceDisk, listWorkspaceSnapshots, workspaceDiskState } from "../workspace";
import type { AccessIdentity } from "../auth";

export const PI_CHAT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,62}$/;

export function piChatObjectName(ownerEmail: string, chatId: string): string {
  return `${ownerEmail.toLowerCase()}/${chatId}`;
}

type PiEnv = { PI_CHAT: DurableObjectNamespace<PiChatAgent> };

export async function openPiChat(env: AppEnv["Bindings"], ownerEmail: string, chatId: string) {
  const email = ownerEmail.toLowerCase();
  const stub = await getAgentByName((env as unknown as PiEnv).PI_CHAT, piChatObjectName(email, chatId));
  await stub.bind({ email }, chatId);
  return stub;
}

async function ownedUnboundPiChat(c: { env: AppEnv["Bindings"]; get: (key: "identity") => { email: string } }, chatId: string) {
  if (!PI_CHAT_ID_PATTERN.test(chatId)) throw new Error("invalid chat id");
  const email = c.get("identity").email.toLowerCase();
  const owned = c.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ? AND engine = 'pi'").bind(chatId, email).first();
  const opened = getAgentByName((c.env as unknown as PiEnv).PI_CHAT, piChatObjectName(email, chatId));
  const [row, stub] = await Promise.all([owned, opened]);
  return row ? { stub, email } : null;
}

async function ownedPiChat(c: { env: AppEnv["Bindings"]; get: (key: "identity") => { email: string } }, chatId: string) {
  const owned = await ownedUnboundPiChat(c, chatId);
  if (!owned) return null;
  await owned.stub.bind({ email: owned.email }, chatId);
  return owned.stub;
}

export async function forkPiChat(env: AppEnv["Bindings"], email: string, sourceId: string, sourceName: string, atMessageId: string): Promise<{ sessionId: string; name: string; messageCount: number }> {
  const owner = email.toLowerCase();
  const entryId = parseForkPoint(atMessageId);
  if (entryId === null) throw new Error("Fork point was not found in this conversation.");
  const source = await getAgentByName((env as unknown as PiEnv).PI_CHAT, piChatObjectName(owner, sourceId));
  await source.bind({ email: owner }, sourceId);
  const entries = await source.forkEntriesAt(entryId);
  const forkId = crypto.randomUUID();
  const name = `Fork · ${sourceName}`.slice(0, 200);
  await env.DB.prepare("INSERT INTO sessions (id, name, status, owner_email, engine, created_at, updated_at) VALUES (?, ?, 'active', ?, 'pi', datetime('now'), datetime('now'))").bind(forkId, name, owner).run();
  try {
    const target = await getAgentByName((env as unknown as PiEnv).PI_CHAT, piChatObjectName(owner, forkId));
    await target.bind({ email: owner }, forkId);
    const messageCount = await target.seedFromFork(entries);
    await copyWorkspaceDisk(env, { email: owner } as AccessIdentity, { kind: "chat", chatId: sourceId }, { kind: "chat", chatId: forkId }).catch((error: unknown) => console.error("pi_fork_disk_copy_failed", { err: String(error) }));
    return { sessionId: forkId, name, messageCount };
  } catch (error) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ? AND owner_email = ?").bind(forkId, owner).run().catch(() => undefined);
    throw error;
  }
}

export function registerPiEngineRoutes(app: Hono<AppEnv>) {
  app.post("/api/pi/chats", async (c) => {
    const email = c.get("identity").email.toLowerCase();
    const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
    const chatId = crypto.randomUUID();
    const name = (body.name ?? "").trim().slice(0, 120) || "Pi chat";
    await c.env.DB.prepare("INSERT INTO sessions (id, name, status, owner_email, engine, created_at, updated_at) VALUES (?, ?, 'active', ?, 'pi', datetime('now'), datetime('now'))").bind(chatId, name, email).run();
    return c.json({ ok: true, result: { chatId, engine: "pi" } });
  });

  app.post("/api/pi/chats/:id/messages", async (c) => {
    const stub = await ownedPiChat(c, c.req.param("id")).catch(() => null);
    if (!stub) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "chat not found" } }, 404);
    const body = await c.req.json<{ text?: string; operationId?: string }>();
    const text = (body.text ?? "").trim();
    if (!text) return c.json({ ok: false, error: { code: "EMPTY", message: "text is required" } }, 400);
    const receipt = await stub.submit(text, body.operationId);
    const title = text.replace(/\s+/g, " ").slice(0, 80);
    await c.env.DB.prepare("UPDATE sessions SET updated_at = datetime('now'), name = CASE WHEN name IN ('New chat', 'Pi chat') THEN ? ELSE name END WHERE id = ?").bind(title, c.req.param("id")).run();
    return c.json({ ok: true, result: receipt });
  });

  app.get("/api/pi/chats/:id/operations/:op", async (c) => {
    const stub = await ownedPiChat(c, c.req.param("id")).catch(() => null);
    if (!stub) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "chat not found" } }, 404);
    const result = await stub.wait(c.req.param("op"));
    return c.json({ ok: true, result });
  });

  app.post("/api/pi/chats/:id/model", async (c) => {
    const stub = await ownedPiChat(c, c.req.param("id")).catch(() => null);
    if (!stub) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "chat not found" } }, 404);
    const body = await c.req.json<{ provider?: string; id?: string }>().catch(() => ({} as { provider?: string; id?: string }));
    const choice = PI_ENGINE_MODEL_CHOICES.find((model) => model.provider === body.provider && model.id === body.id);
    if (!choice) return c.json({ ok: false, error: { code: "UNKNOWN_MODEL", message: "unknown model" } }, 400);
    await stub.setModel(choice.provider, choice.id);
    return c.json({ ok: true, result: choice });
  });

  app.get("/api/sessions/:id/engine", async (c) => {
    const email = c.get("identity").email.toLowerCase();
    const row = await c.env.DB.prepare("SELECT engine FROM sessions WHERE id = ? AND owner_email = ?").bind(c.req.param("id"), email).first<{ engine: string }>();
    if (!row) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "session not found" } }, 404);
    return c.json({ ok: true, result: { engine: row.engine === "pi" ? "pi" : "think" } });
  });

  app.get("/api/pi/models", (c) => c.json({ ok: true, result: { models: PI_ENGINE_MODEL_CHOICES } }));

  app.get("/api/pi/chats/:id/live", async (c) => {
    const chatId = c.req.param("id");
    if (!PI_CHAT_ID_PATTERN.test(chatId)) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "chat not found" } }, 404);
    const email = c.get("identity").email.toLowerCase();
    const ownership = c.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ? AND engine = 'pi'").bind(chatId, email).first();
    const loading = getAgentByName((c.env as unknown as PiEnv).PI_CHAT, piChatObjectName(email, chatId)).then((stub) => stub.slimLiveFor({ email }, chatId));
    const started = Date.now();
    const ownershipTimed = ownership.then((value) => ({ value, ms: Date.now() - started }));
    const loadingTimed = loading.then((value) => ({ value, ms: Date.now() - started })).catch(() => ({ value: null, ms: Date.now() - started }));
    const [row, live] = await Promise.all([ownershipTimed, loadingTimed]);
    if (!row.value || !live.value) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "chat not found" } }, 404);
    c.header("Server-Timing", `d1;dur=${row.ms}, chat;dur=${live.ms}`);
    return c.json({ ok: true, result: live.value } as Record<string, unknown>);
  });

  app.get("/api/pi/chats/:id/entries", async (c) => {
    const stub = await ownedPiChat(c, c.req.param("id")).catch(() => null);
    if (!stub) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "chat not found" } }, 404);
    const before = Number(c.req.query("before") ?? Number.MAX_SAFE_INTEGER);
    const limit = Number(c.req.query("limit") ?? 80);
    const page: unknown = JSON.parse(JSON.stringify(await stub.entriesPage(Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER, Number.isFinite(limit) ? limit : 80)));
    return c.json({ ok: true, result: page } as Record<string, unknown>);
  });

  app.get("/api/pi/chats/:id/entries/:entryId", async (c) => {
    const stub = await ownedPiChat(c, c.req.param("id")).catch(() => null);
    if (!stub) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "chat not found" } }, 404);
    const entry: unknown = JSON.parse(JSON.stringify(await stub.fullEntry(Number(c.req.param("entryId")))));
    if (!entry) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "entry not found" } }, 404);
    return c.json({ ok: true, result: { entry } } as Record<string, unknown>);
  });

  app.get("/api/pi/chats/:id", async (c) => {
    const stub = await ownedPiChat(c, c.req.param("id")).catch(() => null);
    if (!stub) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "chat not found" } }, 404);
    const busy: boolean = await stub.busy();
    const sandboxId: string = await stub.sandboxId();
    const entries: unknown = JSON.parse(await stub.transcriptJson());
    return c.json({ ok: true, result: { busy, sandboxId, entries } } as Record<string, unknown>);
  });

  app.post("/api/pi/chats/:id/workspace/recycle", async (c) => {
    const stub = await ownedPiChat(c, c.req.param("id")).catch(() => null);
    if (!stub) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "chat not found" } }, 404);
    try {
      const result = await stub.recycleWorkspace();
      return c.json({ ok: true, result });
    } catch (error) {
      return c.json({ ok: false, error: { code: "RECYCLE_FAILED", message: error instanceof Error ? error.message : String(error) } }, 502);
    }
  });

  app.get("/api/pi/chats/:id/workspace/snapshots", async (c) => {
    const chatId = c.req.param("id");
    const stub = await ownedPiChat(c, chatId).catch(() => null);
    if (!stub) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "chat not found" } }, 404);
    const snapshots = await listWorkspaceSnapshots(c.env, c.get("identity"), 20, { kind: "chat", chatId });
    return c.json({ ok: true, result: { snapshots } });
  });

  app.get("/api/pi/chats/:id/workspace/disk", async (c) => {
    const chatId = c.req.param("id");
    const stub = await ownedPiChat(c, chatId).catch(() => null);
    if (!stub) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "chat not found" } }, 404);
    const state = await workspaceDiskState(c.env, c.get("identity"), { kind: "chat", chatId });
    return c.json({ ok: true, result: state });
  });

  app.post("/api/pi/chats/:id/abort", async (c) => {
    const stub = await ownedPiChat(c, c.req.param("id")).catch(() => null);
    if (!stub) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "chat not found" } }, 404);
    await stub.abortAll();
    return c.json({ ok: true, result: { aborted: true } });
  });

  app.post("/api/pi/chats/:id/crash", async (c) => {
    const stub = await ownedPiChat(c, c.req.param("id")).catch(() => null);
    if (!stub) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "chat not found" } }, 404);
    await stub.crash().catch(() => undefined);
    return c.json({ ok: true, result: { crashed: true } });
  });
}

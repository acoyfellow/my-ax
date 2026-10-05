import type { Hono } from "hono";
import { getAgentByName } from "agents-pi";
import type { AppEnv } from "../app-env";
import type { PiChatAgent } from "./pi-chat-agent";

export const PI_CHAT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,62}$/;

export function piChatObjectName(ownerEmail: string, chatId: string): string {
  return `${ownerEmail.toLowerCase()}/${chatId}`;
}

type PiEnv = { PI_CHAT: DurableObjectNamespace<PiChatAgent> };

async function ownedPiChat(c: { env: AppEnv["Bindings"]; get: (key: "identity") => { email: string } }, chatId: string) {
  if (!PI_CHAT_ID_PATTERN.test(chatId)) throw new Error("invalid chat id");
  const email = c.get("identity").email.toLowerCase();
  const row = await c.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ? AND engine = 'pi'").bind(chatId, email).first();
  if (!row) return null;
  const stub = await getAgentByName((c.env as unknown as PiEnv).PI_CHAT, piChatObjectName(email, chatId));
  await stub.bind({ email }, chatId);
  return stub;
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
    return c.json({ ok: true, result: receipt });
  });

  app.get("/api/pi/chats/:id/operations/:op", async (c) => {
    const stub = await ownedPiChat(c, c.req.param("id")).catch(() => null);
    if (!stub) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "chat not found" } }, 404);
    const result = await stub.wait(c.req.param("op"));
    return c.json({ ok: true, result });
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

  app.post("/api/pi/chats/:id/abort", async (c) => {
    const stub = await ownedPiChat(c, c.req.param("id")).catch(() => null);
    if (!stub) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "chat not found" } }, 404);
    await stub.abortAll();
    return c.json({ ok: true, result: { aborted: true } });
  });
}

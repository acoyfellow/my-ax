import type { Context, Hono, MiddlewareHandler } from "hono";
import type { AppEnv } from "../app-env";
import { verifyAccessForHook, type HookAccessIdentity } from "../auth";
import { constantTimeEqual, extractHookBearer, mintHookToken, sha256Hex } from "../conversation-hooks";
import { resolvePiModelChoice } from "../pi-engine/gateway-models";

const KEEPALIVE_MS = 10_000;
const MAX_LABEL_LENGTH = 80;
const MAX_TEXT_LENGTH = 100_000;

interface HookRow {
  id: string;
  owner_email: string;
  session_id: string;
  label: string;
  token_hash: string;
  revoked_at: string | null;
}

interface HookChat {
  submit(text: string, operationId?: string): Promise<{ operationId: string; accepted: boolean }>;
  wait(operationId: string): Promise<{ status: string; text?: string; reason?: string }>;
  setModel(provider: string, id: string): Promise<void>;
}

export interface HookDeps {
  verifyAccess: (req: Request, env: AppEnv["Bindings"]) => Promise<HookAccessIdentity>;
  openChat: (env: AppEnv["Bindings"], ownerEmail: string, sessionId: string) => Promise<HookChat>;
}

const defaultDeps: HookDeps = {
  verifyAccess: (req, env) => verifyAccessForHook(req, env),
  openChat: async (env, ownerEmail, sessionId) => {
    const { openPiChat } = await import("../pi-engine/routes");
    return (await openPiChat(env, ownerEmail, sessionId)) as unknown as HookChat;
  },
};

type HookVariables = { Variables: { hook: HookRow } };
type HookContext = Context<AppEnv & HookVariables>;

function ownerOf(c: Context<AppEnv>): string {
  return c.get("identity").email.toLowerCase();
}

function unauthorized(c: Context, tag: string, message: string, status: 401 | 403 = 401) {
  return c.json({ ok: false, error: { tag, message } }, status);
}

export function hookAuthMiddleware(deps: HookDeps = defaultDeps): MiddlewareHandler<AppEnv & HookVariables> {
  return async (c, next) => {
    try {
      await deps.verifyAccess(c.req.raw, c.env);
    } catch {
      return unauthorized(c, "InvalidAccess", "Cloudflare Access verification failed");
    }
    const presented = extractHookBearer(c.req.raw);
    if (!presented) return unauthorized(c, "NoHookToken", "Missing hook token");
    const hookId = c.req.param("hookId") ?? "";
    const row = await c.env.DB.prepare("SELECT id, owner_email, session_id, label, token_hash, revoked_at FROM conversation_hooks WHERE id = ?")
      .bind(hookId)
      .first<HookRow>();
    const presentedHash = await sha256Hex(presented);
    const matches = row ? constantTimeEqual(presentedHash, row.token_hash) : constantTimeEqual(presentedHash, presentedHash.split("").reverse().join(""));
    if (!row || !matches) return unauthorized(c, "InvalidHookToken", "Hook token does not match");
    if (row.revoked_at) return unauthorized(c, "HookRevoked", "Hook has been revoked", 403);
    c.set("hook", row);
    await next();
  };
}

function baseUrlFor(req: Request, hookId: string): string {
  return `${new URL(req.url).origin}/api/hook/${hookId}`;
}

async function readMessageBody(c: HookContext): Promise<{ text: string; model?: string } | null> {
  const body = await c.req.json().catch(() => null) as { text?: unknown; model?: unknown } | null;
  if (!body || typeof body.text !== "string" || !body.text.trim() || body.text.length > MAX_TEXT_LENGTH) return null;
  const model = typeof body.model === "string" && body.model ? body.model : undefined;
  return { text: body.text, model };
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamTurn(chat: HookChat, operationId: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      send(sse("start", { operationId }));
      const keepalive = setInterval(() => send(": keepalive\n\n"), KEEPALIVE_MS);
      try {
        const result = await chat.wait(operationId);
        if (result.text) send(sse("delta", { operationId, text: result.text }));
        send(sse("status", { operationId, status: result.status }));
        if (result.status === "error" || result.status === "failed") send(sse("error", { operationId, message: result.reason ?? result.status }));
        send(sse("done", { operationId, status: result.status }));
      } catch (error) {
        send(sse("error", { operationId, message: error instanceof Error ? error.message : String(error) }));
        send(sse("done", { operationId, status: "error" }));
      } finally {
        clearInterval(keepalive);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } });
}

export function registerHookCallerRoutes(app: Hono<AppEnv>, deps: HookDeps = defaultDeps): void {
  const guard = hookAuthMiddleware(deps);
  const hooks = app as unknown as Hono<AppEnv & HookVariables>;
  hooks.use("/api/hook/:hookId/*", guard);

  hooks.post("/api/hook/:hookId/message", async (c) => {
    const hook = c.get("hook");
    const body = await readMessageBody(c);
    if (!body) return c.json({ ok: false, error: { tag: "InvalidBody", message: "Body must be { text: string, model?: string }" } }, 400);
    const choice = body.model ? resolvePiModelChoice(body.model) : undefined;
    if (body.model && !choice) return c.json({ ok: false, error: { tag: "UnknownModel", message: "Unknown model" } }, 400);
    const chat = await deps.openChat(c.env, hook.owner_email, hook.session_id);
    if (choice) await chat.setModel(choice.provider, choice.id);
    const receipt = await chat.submit(body.text);
    const url = new URL(c.req.url);
    const wantsStream = url.searchParams.get("stream") === "1" || (c.req.header("Accept") ?? "").includes("text/event-stream");
    if (wantsStream) return streamTurn(chat, receipt.operationId);
    if (url.searchParams.get("wait") === "0") return c.json({ ok: true, operationId: receipt.operationId, status: "running" }, 202);
    const result = await chat.wait(receipt.operationId);
    return c.json({ ok: true, operationId: receipt.operationId, status: result.status, text: result.text ?? "" });
  });

  hooks.get("/api/hook/:hookId/turns/:opId", async (c) => {
    const hook = c.get("hook");
    const operationId = c.req.param("opId");
    const chat = await deps.openChat(c.env, hook.owner_email, hook.session_id);
    const result = await chat.wait(operationId);
    return c.json({ ok: true, operationId, status: result.status, text: result.text ?? "" });
  });
}

async function ownsSession(c: Context<AppEnv>, sessionId: string): Promise<boolean> {
  const row = await c.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ?").bind(sessionId, ownerOf(c)).first();
  return Boolean(row);
}

export function registerHookOwnerRoutes(app: Hono<AppEnv>): void {
  app.get("/api/sessions/:id/hooks", async (c) => {
    const sessionId = c.req.param("id");
    if (!(await ownsSession(c, sessionId))) return c.json({ ok: false, error: { tag: "NotFound", message: "Session not found" } }, 404);
    const { results } = await c.env.DB.prepare("SELECT id, label, created_at FROM conversation_hooks WHERE owner_email = ? AND session_id = ? AND revoked_at IS NULL ORDER BY created_at DESC")
      .bind(ownerOf(c), sessionId)
      .all<{ id: string; label: string; created_at: string }>();
    return c.json({ ok: true, hooks: (results ?? []).map((row) => ({ ...row, baseUrl: baseUrlFor(c.req.raw, row.id) })) });
  });

  app.post("/api/sessions/:id/hooks", async (c) => {
    const sessionId = c.req.param("id");
    if (!(await ownsSession(c, sessionId))) return c.json({ ok: false, error: { tag: "NotFound", message: "Session not found" } }, 404);
    const body = await c.req.json().catch(() => ({})) as { label?: unknown };
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, MAX_LABEL_LENGTH) : "HTTP hook";
    const id = crypto.randomUUID();
    const token = mintHookToken();
    await c.env.DB.prepare("INSERT INTO conversation_hooks (id, owner_email, session_id, label, token_hash) VALUES (?, ?, ?, ?, ?)")
      .bind(id, ownerOf(c), sessionId, label, await sha256Hex(token))
      .run();
    return c.json({ ok: true, id, label, baseUrl: baseUrlFor(c.req.raw, id), token }, 201);
  });

  app.delete("/api/sessions/:id/hooks/:hookId", async (c) => {
    const result = await c.env.DB.prepare("UPDATE conversation_hooks SET revoked_at = datetime('now') WHERE id = ? AND session_id = ? AND owner_email = ? AND revoked_at IS NULL")
      .bind(c.req.param("hookId"), c.req.param("id"), ownerOf(c))
      .run();
    if (!result.meta?.changes) return c.json({ ok: false, error: { tag: "NotFound", message: "Hook not found" } }, 404);
    return c.json({ ok: true });
  });
}

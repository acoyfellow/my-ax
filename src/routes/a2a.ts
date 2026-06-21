import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { A2AMessage, bearer, messageHash, newGrantToken, sha256, toA2ATask } from "../a2a";
import { safePublicHttpUrl } from "../public-url";

type Grant = { id: string; owner_email: string; label: string; remote_origin: string; created_at: string; expires_at: string; revoked_at: string | null };
type Task = { id: string; grant_id: string; owner_email: string; message_id: string; message_hash: string; context_id: string; text: string; state: string; created_at: string; updated_at: string };

async function authenticateGrant(c: any): Promise<Grant | null> {
  const token = bearer(c.req.header("authorization"));
  if (!token) return null;
  const grant = await c.env.DB.prepare("SELECT id, owner_email, label, remote_origin, created_at, expires_at, revoked_at FROM a2a_grants WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > datetime('now')").bind(await sha256(token)).first() as Grant | null;
  if (grant) await c.env.DB.prepare("UPDATE a2a_grants SET last_used_at = datetime('now') WHERE id = ?").bind(grant.id).run();
  return grant;
}

function protocolError(c: any, status: number, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

export function registerA2APublicRoutes(app: Hono<AppEnv>) {
  app.get("/.well-known/agent-card.json", (c) => {
    const base = new URL(c.env.BRIDGE_BASE_URL || c.req.url);
    return c.json({
      name: "My AX deployment link",
      description: "Owner-reviewed, text-only requests to one independently operated My AX deployment.",
      version: "0.0.1",
      protocolVersion: "1.0",
      supportedInterfaces: [{ url: new URL("/a2a", base).toString(), protocolBinding: "HTTP+JSON", protocolVersion: "1.0" }],
      capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
      securitySchemes: { deploymentGrant: { type: "http", scheme: "bearer", description: "Directional deployment grant issued by this operator" } },
      security: [{ deploymentGrant: [] }],
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [{
        id: "operator-attention",
        name: "Request operator attention",
        description: "Deliver text for explicit accept, reject, or block review. Acceptance does not execute the text or grant tools.",
        tags: ["operator", "attention", "message"],
        examples: ["Please review this request."],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
      }],
    }, 200, { "Cache-Control": "public, max-age=300" });
  });

  app.post("/a2a/message:send", async (c) => {
    const grant = await authenticateGrant(c);
    if (!grant) return protocolError(c, 401, "unauthorized", "Valid active deployment grant required");
    const parsed = A2AMessage.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return protocolError(c, 400, "invalid_message", "Only bounded text-only user Messages are accepted");
    const hash = await messageHash(parsed.data);
    const prior = await c.env.DB.prepare("SELECT * FROM a2a_tasks WHERE grant_id = ? AND message_id = ?").bind(grant.id, parsed.data.messageId).first<Task>();
    if (prior) return prior.message_hash === hash ? c.json(toA2ATask(prior)) : protocolError(c, 409, "message_id_conflict", "messageId was already used with different content");

    const id = crypto.randomUUID();
    const contextId = parsed.data.contextId ?? crypto.randomUUID();
    const text = parsed.data.parts.map((part) => part.text).join("\n");
    try {
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO a2a_tasks(id, grant_id, owner_email, message_id, message_hash, context_id, text) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, grant.id, grant.owner_email, parsed.data.messageId, hash, contextId, text),
        c.env.DB.prepare("INSERT INTO attention_items(id, owner_email, kind, title, body, href, a2a_task_id) VALUES (?, ?, 'a2a.task', ?, ?, ?, ?)").bind(crypto.randomUUID(), grant.owner_email, `A2A request from ${grant.label}`, text.slice(0, 500), "/?action=attention", id),
      ]);
    } catch (error) {
      // A concurrent identical delivery can lose the unique-key race. Re-read
      // and return the winner rather than creating a second Attention item.
      const winner = await c.env.DB.prepare("SELECT * FROM a2a_tasks WHERE grant_id = ? AND message_id = ?").bind(grant.id, parsed.data.messageId).first<Task>();
      if (winner) return winner.message_hash === hash ? c.json(toA2ATask(winner)) : protocolError(c, 409, "message_id_conflict", "messageId was already used with different content");
      throw error;
    }
    const task = await c.env.DB.prepare("SELECT * FROM a2a_tasks WHERE id = ?").bind(id).first<Task>();
    return c.json(toA2ATask(task!), 201);
  });

  app.get("/a2a/tasks/:id", async (c) => {
    const grant = await authenticateGrant(c);
    if (!grant) return protocolError(c, 401, "unauthorized", "Valid active deployment grant required");
    const task = await c.env.DB.prepare("SELECT * FROM a2a_tasks WHERE id = ? AND grant_id = ?").bind(c.req.param("id"), grant.id).first<Task>();
    return task ? c.json(toA2ATask(task)) : protocolError(c, 404, "not_found", "Task not found");
  });
}

export function registerA2AOwnerRoutes(app: Hono<AppEnv>) {
  app.post("/api/a2a/grants", async (c) => {
    const email = c.get("identity").email.toLowerCase();
    const body: { label?: unknown; remoteOrigin?: unknown; expiresInDays?: unknown } = await c.req.json().catch(() => ({}));
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const remote = typeof body.remoteOrigin === "string" ? safePublicHttpUrl(body.remoteOrigin, { httpsOnly: true }) : null;
    const days = typeof body.expiresInDays === "number" ? Math.floor(body.expiresInDays) : 30;
    if (!label || label.length > 100) return c.json({ error: "label must be 1-100 characters" }, 400);
    if (!remote) return c.json({ error: "remoteOrigin must be a public HTTPS URL" }, 400);
    if (days < 1 || days > 365) return c.json({ error: "expiresInDays must be 1-365" }, 400);
    const id = crypto.randomUUID(), token = newGrantToken();
    await c.env.DB.prepare("INSERT INTO a2a_grants(id, owner_email, label, remote_origin, token_hash, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?))")
      .bind(id, email, label, remote.origin, await sha256(token), `+${days} days`).run();
    return c.json({ grant: { id, label, remoteOrigin: remote.origin, expiresInDays: days, token, warning: "Copy this token now; it cannot be retrieved again." } }, 201);
  });

  app.get("/api/a2a/grants", async (c) => c.json({ grants: (await c.env.DB.prepare("SELECT id, label, remote_origin, created_at, expires_at, last_used_at, revoked_at FROM a2a_grants WHERE owner_email = ? ORDER BY created_at DESC").bind(c.get("identity").email.toLowerCase()).all()).results }));

  app.delete("/api/a2a/grants/:id", async (c) => {
    const owner = c.get("identity").email.toLowerCase();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE a2a_grants SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE id = ? AND owner_email = ?").bind(c.req.param("id"), owner),
      c.env.DB.prepare("UPDATE a2a_tasks SET state = 'canceled', updated_at = datetime('now') WHERE grant_id = ? AND owner_email = ? AND state = 'input-required'").bind(c.req.param("id"), owner),
    ]);
    return c.json({ ok: true });
  });

  app.post("/api/a2a/tasks/:id/:action", async (c) => {
    const action = c.req.param("action");
    if (!["accept", "reject", "block"].includes(action)) return c.json({ error: "invalid action" }, 400);
    const owner = c.get("identity").email.toLowerCase();
    const task = await c.env.DB.prepare("SELECT * FROM a2a_tasks WHERE id = ? AND owner_email = ?").bind(c.req.param("id"), owner).first<Task>();
    if (!task) return c.json({ error: "not found" }, 404);
    if (task.state !== "input-required") return c.json({ task: toA2ATask(task), replay: true });
    const state = action === "accept" ? "completed" : action === "reject" ? "rejected" : "canceled";
    const statements = [c.env.DB.prepare("UPDATE a2a_tasks SET state = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ? AND state = 'input-required'").bind(state, task.id, owner)];
    if (action === "block") statements.push(c.env.DB.prepare("UPDATE a2a_grants SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE id = ? AND owner_email = ?").bind(task.grant_id, owner));
    await c.env.DB.batch(statements);
    const stored = await c.env.DB.prepare("SELECT * FROM a2a_tasks WHERE id = ? AND owner_email = ?").bind(task.id, owner).first<Task>();
    return c.json({ task: toA2ATask(stored!) });
  });
}

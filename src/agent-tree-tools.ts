import type { ToolContext, ToolDef } from "./types";
import { childTaskMessage, parseSpawnArgs, waitOutcome, waitSeconds } from "./agent-tree";

const POLL_MS = 2000;

async function ownedChild(ctx: ToolContext, childId: string): Promise<{ id: string; name: string } | null> {
  return ctx.env.DB.prepare("SELECT id, name FROM sessions WHERE id = ? AND owner_email = ? AND parent_id = ?")
    .bind(childId, ctx.identity.email.toLowerCase(), ctx.sessionId)
    .first<{ id: string; name: string }>();
}

async function lastAssistantText(ctx: ToolContext, childId: string): Promise<string> {
  const row = await ctx.env.DB.prepare("SELECT content FROM conversation_entries WHERE session_id = ? AND owner_email = ? AND role = 'assistant' ORDER BY sequence_number DESC LIMIT 1")
    .bind(childId, ctx.identity.email.toLowerCase())
    .first<{ content: string | null }>();
  return row?.content?.trim() ?? "";
}

export const SPAWN_CHILD_TOOL: ToolDef = {
  name: "spawn_child",
  description: "Start a child conversation for a side task. The child is an ordinary my.ax conversation on the same shared computer, with this conversation as its parent. It starts working on the task at once and you get its id back. When it ends a reply with a line starting DONE:, that line arrives here as a message. Use wait_child to wait for it.",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "What the child should do, in full; it does not see this conversation" },
      name: { type: "string", description: "Optional short title for the child conversation" },
    },
    required: ["task"],
  },
  execute: async (args, ctx) => {
    const request = parseSpawnArgs(args);
    const email = ctx.identity.email.toLowerCase();
    const parent = await ctx.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ?").bind(ctx.sessionId, email).first<{ id: string }>();
    if (!parent) return JSON.stringify({ ok: false, error: "this conversation is not owned by the caller" });
    const childId = crypto.randomUUID();
    await ctx.env.DB.prepare("INSERT INTO sessions (id, name, status, owner_email, engine, parent_id, created_at, updated_at) VALUES (?, ?, 'active', ?, 'pi', ?, datetime('now'), datetime('now'))")
      .bind(childId, request.name, email, ctx.sessionId).run();
    const { sessionControl } = await import("./session-control");
    await (await sessionControl(ctx.env, ctx.identity, childId)).inject(childTaskMessage(ctx.sessionId, request.task), `child:${childId}:task`);
    return JSON.stringify({ ok: true, childId, name: request.name });
  },
};

export const WAIT_CHILD_TOOL: ToolDef = {
  name: "wait_child",
  description: "Wait until a child conversation you started finishes its turn, up to seconds (default 120, at most 600), and return its last answer.",
  parameters: {
    type: "object",
    properties: {
      childId: { type: "string", description: "The id spawn_child returned" },
      seconds: { type: "number", description: "At most 600; default 120" },
    },
    required: ["childId"],
  },
  execute: async (args, ctx) => {
    const childId = typeof args.childId === "string" ? args.childId.trim() : "";
    const child = childId ? await ownedChild(ctx, childId) : null;
    if (!child) return JSON.stringify({ ok: false, error: "unknown child; only children this conversation started can be waited on" });
    const seconds = waitSeconds(args.seconds);
    const { sessionControl } = await import("./session-control");
    const control = await sessionControl(ctx.env, ctx.identity, childId);
    const deadline = Date.now() + seconds * 1000;
    let running = (await control.state()).sessionStatus === "running";
    while (running && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      running = (await control.state()).sessionStatus === "running";
    }
    const outcome = waitOutcome(child.name, running, await lastAssistantText(ctx, childId), seconds);
    return JSON.stringify({ ok: true, childId, ...outcome });
  },
};

import type { Context, Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { SavedRecipeService } from "../saved-recipes";
import { readMachineStatus } from "../rpc/machine-host-client";
import { oauthStoreFor } from "../oauth-store";
import {
  builtinCommands,
  connectorCommands,
  laptopCommands,
  rankCommands,
  recipeCommands,
  skillCommands,
  type Command,
  type ConnectorToolSource,
  type UsageRow,
} from "../commands/registry";
import { draftSkillFromTranscript, parseSkillMarkdown, SkillError, SkillService, skillInjection, skillMarkdown } from "../commands/skills";
import { expandMessage, type MentionResolver } from "../commands/expand";
import { listWorkspaceFiles } from "../commands/mention-sources";
import type { ConnectorExploreResult } from "../connector-explore";
import * as rpc from "../rpc/contract";

export const COMMANDS_ENABLED_KEY = "commands.enabled";

type Ctx = Context<AppEnv>;

const ok = (c: Ctx, result: unknown, status: 200 | 201 = 200) => c.json<ApiResponse>({ ok: true, command: `${c.req.method} ${c.req.path}`, result, next_actions: [] }, status);

function failure(c: Ctx, error: unknown) {
  if (error instanceof SkillError) {
    const status = error.code === "NotFound" ? 404 : error.code === "Conflict" ? 409 : 400;
    return c.json<ApiResponse>({ ok: false, command: `${c.req.method} ${c.req.path}`, error: { code: error.code, message: error.message }, next_actions: [] }, status);
  }
  return c.json<ApiResponse>({ ok: false, command: `${c.req.method} ${c.req.path}`, error: { code: "CommandsFailed", message: error instanceof Error ? error.message : String(error) }, next_actions: [] }, 500);
}

const owner = (c: Ctx) => c.get("identity").email.toLowerCase();

const skills = (c: Ctx) => new SkillService(c.env.DB, owner(c));

export async function commandsEnabled(env: AppEnv["Bindings"], email: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT value_json FROM owner_preferences WHERE owner_email = ? AND preference_key = ?").bind(email.toLowerCase(), COMMANDS_ENABLED_KEY).first<{ value_json: string }>().catch(() => null);
  return row?.value_json !== "false";
}

async function setCommandsEnabled(env: AppEnv["Bindings"], email: string, enabled: boolean): Promise<void> {
  const at = new Date().toISOString();
  await env.DB.prepare("INSERT INTO owner_preferences(owner_email, preference_key, value_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_email, preference_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
    .bind(email.toLowerCase(), COMMANDS_ENABLED_KEY, JSON.stringify(enabled), at, at).run();
}

async function usageRows(env: AppEnv["Bindings"], email: string): Promise<UsageRow[]> {
  const { results = [] } = await env.DB.prepare("SELECT command_id, COUNT(*) AS uses, MAX(used_at) AS last_used_at FROM command_usage WHERE owner_email = ? AND used_at > datetime('now', '-90 days') GROUP BY command_id")
    .bind(email.toLowerCase()).all<UsageRow>().catch(() => ({ results: [] as UsageRow[] }));
  return results;
}

async function connectorTools(c: Ctx): Promise<ConnectorToolSource[]> {
  const identity = c.get("identity");
  const mcps = await oauthStoreFor(c).listUserMcps(identity.email).catch(() => []);
  const labels = new Map(mcps.map((mcp) => [mcp.id, mcp.displayName || mcp.id]));
  const { getConnectorAgent } = await import("../agent-stub");
  const explored: ConnectorExploreResult | null = await rpc.query("Connector.explore", async (): Promise<ConnectorExploreResult> => (await getConnectorAgent(c.env, identity)).connectorExplore() as Promise<ConnectorExploreResult>, 20_000).catch(() => null);
  if (!explored) return [];
  const connected = new Set(explored.servers.filter((server) => server.state === "ready").map((server) => server.id));
  return Object.entries(explored.tools).flatMap(([server, tools]) => tools.map((tool) => ({
    server,
    serverLabel: labels.get(server) ?? server,
    tool: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    connected: connected.has(server),
  })));
}

export async function allCommands(c: Ctx): Promise<Command[]> {
  const email = owner(c);
  const [recipes, skillList, connector, machine] = await Promise.all([
    new SavedRecipeService(c.env, email).list().catch(() => []),
    skills(c).list().catch(() => []),
    c.req.query("connectors") === "0" ? Promise.resolve([]) : connectorTools(c).catch(() => []),
    c.env.MACHINE_HOST ? readMachineStatus(c.env.MACHINE_HOST, email).catch(() => ({ connected: false, tools: [] })) : Promise.resolve({ connected: false, tools: [] }),
  ]);
  return [
    ...builtinCommands(),
    ...recipeCommands(recipes.map((recipe) => ({ id: recipe.id, name: recipe.name, description: recipe.description, inputSchema: recipe.inputSchema, status: recipe.status }))),
    ...skillCommands(skillList),
    ...connectorCommands(connector),
    ...laptopCommands(machine.tools ?? [], machine.connected),
  ];
}

export function registerCommandRoutes(app: Hono<AppEnv>) {
  app.get("/api/commands", async (c) => {
    try {
      const email = owner(c);
      const enabled = await commandsEnabled(c.env, email);
      if (!enabled) return ok(c, { enabled: false, commands: [] });
      const [commands, usage] = await Promise.all([allCommands(c), usageRows(c.env, email)]);
      const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 200));
      return ok(c, { enabled: true, commands: rankCommands(commands, c.req.query("q") ?? "", usage, Date.now(), limit) });
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post("/api/commands/settings", async (c) => {
    const body = await c.req.json<{ enabled?: unknown }>().catch(() => ({} as { enabled?: unknown }));
    if (typeof body.enabled !== "boolean") return failure(c, new SkillError("BadRequest", "enabled must be true or false"));
    await setCommandsEnabled(c.env, owner(c), body.enabled);
    return ok(c, { enabled: body.enabled });
  });

  app.post("/api/commands/usage", async (c) => {
    const body = await c.req.json<{ commandId?: unknown; kind?: unknown; ok?: unknown; ms?: unknown }>().catch(() => ({} as Record<string, unknown>));
    if (typeof body.commandId !== "string" || !body.commandId || body.commandId.length > 200) return failure(c, new SkillError("BadRequest", "commandId is required"));
    const kind = typeof body.kind === "string" ? body.kind.slice(0, 32) : "unknown";
    await c.env.DB.prepare("INSERT INTO command_usage (owner_email, command_id, kind, ok, ms, used_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
      .bind(owner(c), body.commandId, kind, body.ok === false ? 0 : 1, typeof body.ms === "number" ? Math.round(body.ms) : null).run();
    return ok(c, { recorded: true }, 201);
  });

  app.post("/api/commands/expand", async (c) => {
    try {
      const body = await c.req.json<{ text?: unknown; sessionId?: unknown }>().catch(() => ({} as { text?: unknown; sessionId?: unknown }));
      if (typeof body.text !== "string") throw new SkillError("BadRequest", "text is required");
      const email = owner(c);
      const service = skills(c);
      const resolver: MentionResolver = {
        skill: async (name) => service.byName(name),
        chat: async (id) => {
          const session = await c.env.DB.prepare("SELECT name FROM sessions WHERE id = ? AND owner_email = ?").bind(id, email).first<{ name: string }>();
          if (!session) return null;
          const { results = [] } = await c.env.DB.prepare("SELECT role, content FROM conversation_entries WHERE session_id = ? AND owner_email = ? AND role IN ('user', 'assistant') ORDER BY id DESC LIMIT 12").bind(id, email).all<{ role: string; content: string }>();
          return { name: session.name, turns: results.reverse().map((row) => ({ role: row.role, text: row.content })) };
        },
      };
      const expanded = await expandMessage(body.text, resolver, skillInjection);
      if (expanded.skill) {
        await c.env.DB.prepare("INSERT INTO command_usage (owner_email, command_id, kind, ok, ms, used_at) VALUES (?, ?, 'skill', 1, NULL, datetime('now'))").bind(email, `skill:${expanded.skill.id}`).run().catch(() => undefined);
      }
      return ok(c, { text: expanded.text, files: expanded.files, skill: expanded.skill ? { id: expanded.skill.id, name: expanded.skill.name } : null, unresolved: expanded.unresolved });
    } catch (error) { return failure(c, error); }
  });

  app.get("/api/mentions", async (c) => {
    try {
      const q = (c.req.query("q") ?? "").toLowerCase();
      const email = owner(c);
      const { results: chats = [] } = await c.env.DB.prepare("SELECT id, name FROM sessions WHERE owner_email = ? AND (status IS NULL OR status != 'archived') AND lower(name) LIKE ? ORDER BY updated_at DESC LIMIT 8").bind(email, `%${q}%`).all<{ id: string; name: string }>();
      const skillList = (await skills(c).list()).filter((skill) => skill.name.includes(q)).slice(0, 8);
      const files = await listWorkspaceFiles(c, c.req.query("sessionId") ?? null, q).catch(() => []);
      return ok(c, {
        mentions: [
          ...files.map((path) => ({ kind: "file", ref: path, label: path.split("/").pop() ?? path, detail: path })),
          ...chats.map((chat) => ({ kind: "chat", ref: chat.id, label: chat.name, detail: "conversation" })),
          ...skillList.map((skill) => ({ kind: "skill", ref: skill.name, label: skill.name, detail: skill.description })),
        ],
      });
    } catch (error) { return failure(c, error); }
  });

  app.get("/api/skills", async (c) => {
    try { return ok(c, { skills: await skills(c).list() }); } catch (error) { return failure(c, error); }
  });

  app.post("/api/skills", async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
      const draft = typeof body.markdown === "string" ? { ...parseSkillMarkdown(body.markdown), ...body } : body;
      return ok(c, { skill: await skills(c).create(draft) }, 201);
    } catch (error) { return failure(c, error); }
  });

  app.post("/api/skills/from-session/:sessionId", async (c) => {
    try {
      const sessionId = c.req.param("sessionId");
      const session = await c.env.DB.prepare("SELECT name FROM sessions WHERE id = ? AND owner_email = ?").bind(sessionId, owner(c)).first<{ name: string }>();
      if (!session) throw new SkillError("NotFound", "conversation not found");
      const { results = [] } = await c.env.DB.prepare("SELECT role, content FROM conversation_entries WHERE session_id = ? AND owner_email = ? AND role IN ('user', 'assistant') ORDER BY id ASC LIMIT 200")
        .bind(sessionId, owner(c)).all<{ role: string; content: string }>();
      const draft = draftSkillFromTranscript(session.name, results.map((row) => ({ role: row.role, text: row.content })));
      return ok(c, { draft: { ...draft, sourceSessionId: sessionId } });
    } catch (error) { return failure(c, error); }
  });

  app.get("/api/skills/:id", async (c) => {
    try {
      const skill = await skills(c).get(c.req.param("id"));
      if (c.req.query("format") === "md") return c.body(skillMarkdown(skill), 200, { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${skill.name}.md"` });
      return ok(c, { skill });
    } catch (error) { return failure(c, error); }
  });

  app.patch("/api/skills/:id", async (c) => {
    try { return ok(c, { skill: await skills(c).update(c.req.param("id"), await c.req.json<Record<string, unknown>>().catch(() => ({}))) }); } catch (error) { return failure(c, error); }
  });

  app.delete("/api/skills/:id", async (c) => {
    try { await skills(c).remove(c.req.param("id")); return ok(c, { removed: true }); } catch (error) { return failure(c, error); }
  });
}

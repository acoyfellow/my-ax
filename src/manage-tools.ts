import { SESSION_SQL, sessionWrite, type SessionStoreDb } from "./domain/Session/Session.store";
import { Effect } from "effect";
import { deleteOwnedArtifact, listOwnedArtifacts, renameOwnedArtifact, updateOwnedArtifactSource } from "./artifacts";
import { resolveBridgeOrigin } from "./bridge-origin";
import { SkillService } from "./commands/skills";
import { probeMcp } from "./mcp-probe";
import { makeOAuthClientStore } from "./oauth-store";
import { SavedRecipeService } from "./saved-recipes";
import type { ToolContext, ToolDef } from "./types";

type Args = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : "");
const ok = (body: Record<string, unknown>) => JSON.stringify({ ok: true, ...body });

function unknownAction(kind: string, action: unknown): never {
  throw new Error(`unknown ${kind} action: ${String(action)}`);
}

export const MANAGE_WIDGETS_TOOL: ToolDef = {
  name: "manage_widgets",
  description: "List, rename, change the source of, or delete the owner's saved widgets (Svelte artifacts). Create new ones with create_svelte_artifact and read source with get_artifact. update_source keeps the same id, so every place the widget is shown picks up the change. Ask the owner before delete.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "rename", "update_source", "delete"] },
      id: { type: "string", description: "Widget id" },
      title: { type: "string", description: "New title, for rename" },
      source: { type: "string", description: "Complete new Svelte 5 source, for update_source" },
    },
    required: ["action"],
  },
  execute: async (args: Args, ctx: ToolContext) => {
    const id = text(args.id);
    if (args.action === "list") return ok({ widgets: await listOwnedArtifacts(ctx.env, ctx.identity) });
    if (args.action === "rename") return ok({ renamed: await renameOwnedArtifact(ctx.env, ctx.identity, id, text(args.title)) });
    if (args.action === "update_source") {
      const updated = await updateOwnedArtifactSource(ctx.env, ctx.identity, id, text(args.source));
      if (!updated) return JSON.stringify({ ok: false, error: "widget not found" });
      return ok({ kind: "svelte-artifact", ...updated });
    }
    if (args.action === "delete") return ok({ deleted: await deleteOwnedArtifact(ctx.env, ctx.identity, id) });
    return unknownAction("widget", args.action);
  },
};

export const MANAGE_SKILLS_TOOL: ToolDef = {
  name: "manage_skills",
  description: "List, get, create, update, or delete the owner's skills. A skill is saved instructions the owner calls with /name. Ask the owner before delete.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "get", "create", "update", "delete"] },
      id: { type: "string", description: "Skill id, for get, update and delete" },
      name: { type: "string", description: "Slash name, lowercase with hyphens" },
      description: { type: "string" },
      instructions: { type: "string", description: "Full instructions in markdown" },
    },
    required: ["action"],
  },
  execute: async (args: Args, ctx: ToolContext) => {
    const skills = new SkillService(ctx.env.DB, ctx.identity.email);
    const id = text(args.id);
    const draft = {
      ...(typeof args.name === "string" ? { name: args.name } : {}),
      ...(typeof args.description === "string" ? { description: args.description } : {}),
      ...(typeof args.instructions === "string" ? { instructions: args.instructions } : {}),
    };
    if (args.action === "list") return ok({ skills: await skills.list() });
    if (args.action === "get") return ok({ skill: await skills.get(id) });
    if (args.action === "create") return ok({ skill: await skills.create(draft) });
    if (args.action === "update") return ok({ skill: await skills.update(id, draft) });
    if (args.action === "delete") {
      await skills.remove(id);
      return ok({ deleted: id });
    }
    return unknownAction("skill", args.action);
  },
};

export const MANAGE_RECIPES_TOOL: ToolDef = {
  name: "manage_recipes",
  description: "List, get, create, update, or delete the owner's saved recipes (reusable codemode scripts). A new recipe waits for the owner's approval before it can run. Ask the owner before delete.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "get", "create", "update", "delete"] },
      id: { type: "string", description: "Recipe id, for get, update and delete" },
      recipe: { type: "object", description: "For create and update: { name, description, code, inputSchema? }" },
    },
    required: ["action"],
  },
  execute: async (args: Args, ctx: ToolContext) => {
    const recipes = new SavedRecipeService(ctx.env, ctx.identity.email);
    const id = text(args.id);
    if (args.action === "list") return ok({ recipes: await recipes.list() });
    if (args.action === "get") return ok({ recipe: await recipes.get(id) });
    if (args.action === "create") return ok({ recipe: await recipes.create(args.recipe) });
    if (args.action === "update") return ok({ recipe: await recipes.update(id, args.recipe) });
    if (args.action === "delete") return ok({ deleted: await recipes.delete(id) });
    return unknownAction("recipe", args.action);
  },
};

function connectorStore(ctx: ToolContext) {
  const binding = ctx.env.OAUTH_CLIENT;
  if (!binding) throw new Error("connector store is not configured");
  const origin = resolveBridgeOrigin(ctx.env.BRIDGE_BASE_URL);
  if (!origin) throw new Error("BRIDGE_BASE_URL is not set, so connectors can't be managed from chat. Use Settings, Connections.");
  return makeOAuthClientStore(binding, origin);
}

export const MANAGE_CONNECTORS_TOOL: ToolDef = {
  name: "manage_connectors",
  description: "List, add, rename, or remove the owner's own MCP connectors. add probes the URL first; if the server needs OAuth, tell the owner to finish sign-in in Settings, Connections. Ask the owner before remove.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "add", "rename", "remove"] },
      id: { type: "string", description: "Connector id, for rename and remove" },
      url: { type: "string", description: "MCP server URL, for add" },
      displayName: { type: "string", description: "New name, for rename" },
    },
    required: ["action"],
  },
  execute: async (args: Args, ctx: ToolContext) => {
    const store = connectorStore(ctx);
    const email = ctx.identity.email;
    if (args.action === "list") return ok({ connectors: await store.listUserMcps(email) });
    if (args.action === "add") {
      const probe = await Effect.runPromise(probeMcp(text(args.url)));
      if (!probe.ok) return JSON.stringify({ ok: false, error: probe.detail });
      return ok({ connector: await store.addUserMcp(email, probe.connector) });
    }
    if (args.action === "rename") return ok({ connector: await store.renameUserMcp(email, text(args.id), text(args.displayName)) });
    if (args.action === "remove") {
      await store.removeUserMcp(email, text(args.id));
      return ok({ removed: text(args.id) });
    }
    return unknownAction("connector", args.action);
  },
};

export const MANAGE_CONVERSATIONS_TOOL: ToolDef = {
  name: "manage_conversations",
  description: "List or rename the owner's conversations. To delete one, ask the owner to do it from the sidebar.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "rename"] },
      id: { type: "string", description: "Conversation id, for rename. Omit to rename this conversation." },
      name: { type: "string", description: "New name, for rename" },
      limit: { type: "number", description: "For list: max rows, default 50" },
    },
    required: ["action"],
  },
  execute: async (args: Args, ctx: ToolContext) => {
    const email = ctx.identity.email;
    if (args.action === "list") {
      const limit = Math.max(1, Math.min(Number(args.limit) || 50, 200));
      const rows = await ctx.env.DB.prepare("SELECT id, name, status, pinned, updated_at FROM sessions WHERE owner_email = ? ORDER BY updated_at DESC LIMIT ?")
        .bind(email, limit).all();
      return ok({ conversations: rows.results ?? [] });
    }
    if (args.action === "rename") {
      const id = text(args.id) || ctx.sessionId || "";
      const name = text(args.name).trim().slice(0, 200);
      if (!name) throw new Error("name is required");
      const result = await sessionWrite(ctx.env.DB as unknown as SessionStoreDb, SESSION_SQL.S08_NAME, [name, id, email]);
      return ok({ renamed: (result.meta?.changes ?? 0) > 0, id, name });
    }
    return unknownAction("conversation", args.action);
  },
};

export const MANAGE_TOOLS: ToolDef[] = [MANAGE_WIDGETS_TOOL, MANAGE_SKILLS_TOOL, MANAGE_RECIPES_TOOL, MANAGE_CONNECTORS_TOOL, MANAGE_CONVERSATIONS_TOOL];

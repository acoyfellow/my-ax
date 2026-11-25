import { Effect } from "effect";
import { createSvelteArtifact, readOwnedSvelteArtifact } from "./artifacts";
import { databaseLayer } from "./effect/database";
import { SESSION_SQL, sessionWrite, type SessionStoreDb } from "./domain/Session/Session.store";
import { setSessionPinned } from "./session-pinning-program";
import { parsePinSize } from "./session-pin-size";
import { getUserAgent } from "./agent-stub";
import { mergeTileState, parseTileState, type TileStateObject } from "./tile-panel";
import type { AccessIdentity } from "./auth";
import type { Env, ToolContext, ToolDef } from "./types";

type TileRow = {
  id: string;
  name: string | null;
  tile_artifact_id: string | null;
  tile_state_json: string | null;
};

async function ownedTileRow(env: Env, ownerEmail: string, sessionId: string): Promise<TileRow | null> {
  return env.DB.prepare(
    "SELECT id, name, tile_artifact_id, tile_state_json FROM sessions WHERE id = ? AND owner_email = ?",
  ).bind(sessionId, ownerEmail.toLowerCase()).first<TileRow>();
}

async function broadcastTileUpdate(env: Env, ownerEmail: string, sessionId: string, tileArtifactId: string | null, tileState: TileStateObject): Promise<void> {
  try {
    await (await getUserAgent(env, ownerEmail)).announceSessionTile(sessionId, tileArtifactId, tileState);
  } catch {}
}

export async function readSessionTilePanel(env: Env, identity: AccessIdentity, sessionId: string) {
  const row = await ownedTileRow(env, identity.email, sessionId);
  if (!row) return null;
  const state = parseTileState(row.tile_state_json);
  const artifact = row.tile_artifact_id ? await readOwnedSvelteArtifact(env, identity, row.tile_artifact_id) : null;
  return {
    sessionId: row.id,
    name: row.name,
    artifactId: artifact?.id ?? null,
    title: artifact?.title ?? null,
    source: artifact?.source ?? null,
    state,
  };
}

export async function saveSessionTilePanel(
  env: Env,
  identity: AccessIdentity,
  sessionId: string,
  input: { source: string; title?: string; state?: unknown; pin?: boolean; size?: string },
) {
  const row = await ownedTileRow(env, identity.email, sessionId);
  if (!row) return null;
  const artifact = await createSvelteArtifact(env, identity, sessionId, {
    title: (input.title ?? "").trim() || `${row.name || "Chat"} tile`,
    source: input.source,
  });
  const current = parseTileState(row.tile_state_json);
  const merged = input.state !== undefined ? mergeTileState(current, input.state) : { state: current, json: JSON.stringify(current) };
  await sessionWrite(env.DB as unknown as SessionStoreDb, SESSION_SQL.S17_TILE, [
    artifact.artifactId,
    merged.json,
    sessionId,
    identity.email.toLowerCase(),
  ]);
  if (input.pin) {
    await Effect.runPromise(setSessionPinned(identity.email, sessionId, true).pipe(Effect.provide(databaseLayer(env.DB)))).catch(() => undefined);
  }
  if (input.size) {
    const parsedSize = parsePinSize(input.size);
    if (parsedSize) {
      await sessionWrite(env.DB as unknown as SessionStoreDb, SESSION_SQL.S11_PIN, [parsedSize, sessionId, identity.email.toLowerCase()]).catch(() => undefined);
    }
  }
  await broadcastTileUpdate(env, identity.email, sessionId, artifact.artifactId, merged.state);
  return { sessionId, artifactId: artifact.artifactId, title: artifact.title, state: merged.state };
}

export async function patchSessionTileState(env: Env, identity: AccessIdentity, sessionId: string, patch: unknown) {
  const row = await ownedTileRow(env, identity.email, sessionId);
  if (!row) return null;
  const merged = mergeTileState(parseTileState(row.tile_state_json), patch);
  await sessionWrite(env.DB as unknown as SessionStoreDb, SESSION_SQL.S18_TILE_STATE, [
    merged.json,
    sessionId,
    identity.email.toLowerCase(),
  ]);
  await broadcastTileUpdate(env, identity.email, sessionId, row.tile_artifact_id, merged.state);
  return { sessionId, artifactId: row.tile_artifact_id, state: merged.state };
}

export async function clearSessionTilePanel(env: Env, identity: AccessIdentity, sessionId: string): Promise<boolean> {
  const row = await ownedTileRow(env, identity.email, sessionId);
  if (!row) return false;
  await sessionWrite(env.DB as unknown as SessionStoreDb, SESSION_SQL.S17_TILE, [
    null,
    null,
    sessionId,
    identity.email.toLowerCase(),
  ]);
  await broadcastTileUpdate(env, identity.email, sessionId, null, {});
  return true;
}

function targetSessionId(args: Record<string, unknown>, ctx: ToolContext): string {
  const explicit = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
  return explicit || ctx.sessionId;
}

export const SET_TILE_PANEL_TOOL: ToolDef = {
  name: "set_tile_panel",
  description: "Compile and attach a live Svelte 5 micro-panel inside a conversation's sidebar tile (this conversation by default, or any owned sessionId such as a child from spawn_child). Exact safe inner box budgets (zero scrolling, overflow hidden): small ~104x24px, medium ~232x30px, large ~232x74px. Inside the Svelte component, read window.myAxTile.state and window.myAxTile.session, subscribe via $effect(() => window.myAxTile?.onUpdate((s) => { state = s; })), and optionally steer the chat with window.myAxTile.send(text) from a <button>. Use theme tokens var(--fg), var(--fg-mut), var(--brand), var(--good), var(--warn), var(--bad), var(--line), var(--seismo-box), var(--seismo-mac), var(--seismo-web).",
  parameters: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Target conversation id. Omit to update the current conversation's tile." },
      title: { type: "string", description: "Short title for the compiled tile panel." },
      source: { type: "string", description: "Self-contained Svelte 5 component source for the sidebar tile body." },
      state: { type: "object", description: "Initial JSON state object pushed live into window.myAxTile.state." },
      pin: { type: "boolean", description: "Pin the conversation to the sidebar tile grid so the panel is visible immediately." },
      size: { type: "string", enum: ["small", "medium", "large"], description: "Optional pinned tile size." },
    },
    required: ["source"],
  },
  execute: async (args, ctx) => {
    const source = typeof args.source === "string" ? args.source : "";
    if (!source.trim()) return JSON.stringify({ ok: false, error: "source is required" });
    const id = targetSessionId(args, ctx);
    const saved = await saveSessionTilePanel(ctx.env, ctx.identity, id, {
      source,
      title: typeof args.title === "string" ? args.title : undefined,
      state: args.state,
      pin: args.pin === true,
      size: typeof args.size === "string" ? args.size : undefined,
    });
    if (!saved) return JSON.stringify({ ok: false, error: "conversation not found or not owned" });
    return JSON.stringify({ ok: true, ...saved });
  },
};

export const UPDATE_TILE_STATE_TOOL: ToolDef = {
  name: "update_tile_state",
  description: "Push a realtime JSON state patch to a conversation's sidebar tile panel without recompiling Svelte. Every open sidebar updates immediately via window.myAxTile.onUpdate.",
  parameters: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Target conversation id. Omit to update the current conversation's tile." },
      patch: { type: "object", description: "JSON key-value fields to merge into the tile's live state." },
    },
    required: ["patch"],
  },
  execute: async (args, ctx) => {
    const id = targetSessionId(args, ctx);
    const updated = await patchSessionTileState(ctx.env, ctx.identity, id, args.patch);
    if (!updated) return JSON.stringify({ ok: false, error: "conversation not found or not owned" });
    return JSON.stringify({ ok: true, ...updated });
  },
};

export const READ_TILE_PANEL_TOOL: ToolDef = {
  name: "read_tile_panel",
  description: "Read the current Svelte source and live JSON state of a conversation's sidebar tile panel (this conversation or any other owned sessionId).",
  parameters: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Target conversation id. Omit to read the current conversation's tile." },
    },
  },
  execute: async (args, ctx) => {
    const id = targetSessionId(args, ctx);
    const panel = await readSessionTilePanel(ctx.env, ctx.identity, id);
    if (!panel) return JSON.stringify({ ok: false, error: "conversation not found or not owned" });
    return JSON.stringify({ ok: true, ...panel });
  },
};

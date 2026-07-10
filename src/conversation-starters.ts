// Owner-editable conversation starters (the 4 cards on a new conversation).
//
// Stored per-owner in owner_preferences (JSON), so they sync across devices and
// are editable from Settings AND by the agent (manage_starters tool) through
// the same store. Seeds with sensible defaults when the owner has none.

import type { Env } from "./types";

const STARTERS_KEY = "conversation_starters.v1";
const MAX_STARTERS = 8;      // room to add a couple beyond the default 4
const MAX_TITLE = 60;
const MAX_HINT = 120;
const MAX_PROMPT = 2000;

export type ConversationStarter = { title: string; hint?: string; prompt: string };

/** The built-in defaults shown to an owner who hasn't customized theirs. */
export const DEFAULT_STARTERS: ConversationStarter[] = [
  { title: "Inspect my workspace", hint: "Uses the persistent My AX Workspace.", prompt: "What's in /home/user? Pick anything interesting and tell me about it." },
  { title: "Add an MCP server", hint: "Settings → Connectors → Add MCP server (BYO OAuth).", prompt: "How do I add a new MCP server here? Walk me through Settings → Connectors." },
  { title: "Quick research question", hint: "Plain reasoning, no tool calls.", prompt: "Explain the difference between Cloudflare Sandbox SDK and Containers in 5 bullets." },
  { title: "Script + run end-to-end", hint: "Exercises workspace.write + workspace.exec through Work Code Mode.", prompt: "Write a small Python script to /home/user/hello.py that prints the date, then run it." },
];

function ownerEmail(value: string): string {
  return value.trim().toLowerCase();
}

function cleanStr(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * Validate + normalize an arbitrary starters payload into a bounded list.
 * Drops entries missing a title or prompt; caps count and field lengths; omits
 * empty hints. Pure — safe to unit-test and to reuse for the agent tool.
 */
export function normalizeStarters(input: unknown): ConversationStarter[] {
  if (!Array.isArray(input)) return [];
  const out: ConversationStarter[] = [];
  for (const raw of input) {
    if (out.length >= MAX_STARTERS) break;
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const title = cleanStr(r.title, MAX_TITLE);
    const prompt = cleanStr(r.prompt, MAX_PROMPT);
    if (!title || !prompt) continue; // both required
    const hint = cleanStr(r.hint, MAX_HINT);
    out.push(hint ? { title, hint, prompt } : { title, prompt });
  }
  return out;
}

/** Read the owner's starters, falling back to the built-in defaults. */
export async function getConversationStarters(env: Env, email: string): Promise<ConversationStarter[]> {
  try {
    const row = await env.DB.prepare(
      "SELECT value_json FROM owner_preferences WHERE owner_email = ? AND preference_key = ?",
    ).bind(ownerEmail(email), STARTERS_KEY).first<{ value_json: string }>();
    if (row?.value_json) {
      const parsed = JSON.parse(row.value_json) as { starters?: unknown };
      const starters = normalizeStarters(parsed.starters);
      if (starters.length) return starters;
    }
  } catch (error) {
    if (!String(error).includes("no such table")) throw error;
  }
  return DEFAULT_STARTERS;
}

/** Replace the owner's starters with a normalized list. Empty input resets to
 *  defaults (stored explicitly so the owner's "cleared" state is durable). */
export async function setConversationStarters(env: Env, email: string, input: unknown): Promise<ConversationStarter[]> {
  const starters = normalizeStarters(input);
  const toStore = starters.length ? starters : DEFAULT_STARTERS;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO owner_preferences (owner_email, preference_key, value_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(owner_email, preference_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).bind(ownerEmail(email), STARTERS_KEY, JSON.stringify({ starters: toStore }), now, now).run();
  return toStore;
}

export { MAX_STARTERS };

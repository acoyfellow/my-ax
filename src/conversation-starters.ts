// Owner-editable conversation starters (the 4 cards on a new conversation).
//
// Stored per-owner in owner_preferences (JSON), so they sync across devices and
// are editable from Settings AND by the agent (manage_starters tool) through
// the same store. Seeds with sensible defaults when the owner has none.

export const STARTERS_KEY = "conversation_starters.v1";
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

function cleanStr(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Collapse whitespace incl. U+200B ZERO WIDTH SPACE (not matched by \s), so a
  // field that is only invisible characters normalizes to empty and fails the
  // required-field check. Slice by code point, not UTF-16 unit, so truncation
  // never severs an astral character into a lone surrogate.
  const collapsed = value.replace(/[\s\u200B]+/g, " ").trim();
  return Array.from(collapsed).slice(0, max).join("");
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

export { MAX_STARTERS };

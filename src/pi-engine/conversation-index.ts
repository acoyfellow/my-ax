export type IndexableEntry = { id: number; kind: string; model?: readonly unknown[] };
export type IndexRow = { piEntryId: number; role: "user" | "assistant" | "tool"; tool: string | null; isError: boolean; content: string };

type Part = { type?: string; text?: string; name?: string };
type ModelMessage = { role?: string; content?: string | Part[]; toolName?: string; isError?: boolean };

function textOf(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  return (content ?? []).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

function toolCallsOf(content: ModelMessage["content"]): string[] {
  if (!Array.isArray(content)) return [];
  return content.filter((part) => part.type === "toolCall" && typeof part.name === "string").map((part) => part.name as string);
}

export function indexRowsFor(entries: readonly IndexableEntry[], afterEntryId: number): IndexRow[] {
  const rows: IndexRow[] = [];
  for (const entry of [...entries].sort((a, b) => a.id - b.id)) {
    if (entry.id <= afterEntryId) continue;
    for (const raw of entry.model ?? []) {
      const message = raw as ModelMessage;
      if (entry.kind === "pi.user" && message.role === "user") {
        const content = textOf(message.content).trim();
        if (content) rows.push({ piEntryId: entry.id, role: "user", tool: null, isError: false, content });
      } else if (entry.kind === "pi.assistant" && message.role === "assistant") {
        const content = textOf(message.content).trim();
        const calls = toolCallsOf(message.content);
        if (content || calls.length) rows.push({ piEntryId: entry.id, role: "assistant", tool: null, isError: false, content: content || `[called ${calls.join(", ")}]` });
      } else if (entry.kind === "pi.tool-result" && message.role === "toolResult") {
        rows.push({ piEntryId: entry.id, role: "tool", tool: message.toolName ?? null, isError: Boolean(message.isError), content: textOf(message.content).slice(0, 8000) });
      }
    }
  }
  return rows;
}

export type ConversationMemory = {
  search(query: string, options: { limit?: number; sort?: "relevance" | "recent"; since?: string; until?: string }): Promise<Array<{ sessionId: string; ts: string; role: string; snippet: string }>>;
  read(sessionId: string, limit: number): Promise<Array<{ ts: string; role: string; tool: string | null; content: string }>>;
};

export const PI_MEMORY_INSTRUCTIONS = "Conversation memory: every chat (both engines) is indexed in full-text search. Use search_conversations to find earlier conversations and read_conversation to read one, for example to pick up a frozen or dead chat. Don't claim you have no memory of earlier conversations without searching.";

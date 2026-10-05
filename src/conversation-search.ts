export type ConversationSearchOptions = {
  limit?: number;
  sort?: "relevance" | "recent";
  since?: string;
  until?: string;
};

export type ConversationSearchQuery = { sql: string; params: Array<string | number> } | null;

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function buildConversationSearchQuery(query: string, ownerEmail: string, options: ConversationSearchOptions = {}): ConversationSearchQuery {
  const tokens = (query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 24);
  if (!tokens.length) return null;
  const ftsQuery = tokens.map((token) => `"${token}"`).join(" ");
  const params: Array<string | number> = [ftsQuery, ownerEmail.toLowerCase()];
  const filters: string[] = [];
  const since = normalizeTimestamp(options.since);
  const until = normalizeTimestamp(options.until);
  if (since) { filters.push("e.ts >= ?"); params.push(since); }
  if (until) { filters.push("e.ts <= ?"); params.push(until); }
  const order = options.sort === "recent" ? "e.ts DESC" : "bm25(conversation_entries_fts)";
  params.push(Math.max(1, Math.min(options.limit ?? 20, 100)));
  const where = ["conversation_entries_fts MATCH ?", "e.owner_email = ?", ...filters].join(" AND ");
  return {
    sql: `SELECT e.session_id AS sessionId, e.ts, e.role, snippet(conversation_entries_fts, 0, '<<', '>>', '…', 24) AS snippet FROM conversation_entries_fts JOIN conversation_entries e ON e.id = conversation_entries_fts.rowid WHERE ${where} ORDER BY ${order} LIMIT ?`,
    params,
  };
}

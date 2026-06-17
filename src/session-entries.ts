export type ConversationEntryRow = {
  id: number;
  ts: string;
  role: string;
  tool: string | null;
  is_error: number;
  content: string | null;
  meta_json: string | null;
};

export function clampEntriesLimit(raw: string | undefined): number {
  const n = Number(raw ?? "50");
  return Math.min(200, Math.max(1, Number.isFinite(n) ? Math.floor(n) : 50));
}

export function parseEntriesCursor(raw: string | undefined): number | null {
  const value = raw ?? "0";
  return /^\d+$/.test(value) ? Number(value) : null;
}

export function pageConversationEntries(rows: ConversationEntryRow[], limit: number, after: number) {
  const page = rows.slice(0, limit);
  const entries = page.map((row) => {
    let meta: unknown = null;
    try { meta = row.meta_json ? JSON.parse(row.meta_json) : null; } catch { meta = row.meta_json; }
    return { id: String(row.id), role: row.role, content: row.content ?? "", createdAt: row.ts, tool: row.tool, isError: row.is_error === 1, meta };
  });
  return { entries, nextCursor: entries.at(-1)?.id ?? String(after), hasMore: rows.length > limit };
}

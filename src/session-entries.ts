import { isCompactionSummaryId } from "./compaction-summary";

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
  if (!/^\d+$/.test(value)) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : null;
}

function parseMeta(metaJson: string | null): unknown {
  try { return metaJson ? JSON.parse(metaJson) : null; } catch { return metaJson; }
}

function messageIdFromMeta(meta: unknown): unknown {
  return typeof meta === "object" && meta !== null && "uiMessageId" in meta
    ? (meta as { uiMessageId?: unknown }).uiMessageId
    : undefined;
}

function isOwnerVisible(row: ConversationEntryRow): boolean {
  return !isCompactionSummaryId(messageIdFromMeta(parseMeta(row.meta_json)));
}

function mapRow(row: ConversationEntryRow) {
  const meta = parseMeta(row.meta_json);
  return { id: String(row.id), role: row.role, content: row.content ?? "", createdAt: row.ts, tool: row.tool, isError: row.is_error === 1, meta };
}

export function pageConversationEntries(rows: ConversationEntryRow[], limit: number, after: number) {
  const page = rows.slice(0, limit);
  const entries = page.filter(isOwnerVisible).map(mapRow);
  const lastPageEntry = page.at(-1);
  return { entries, nextCursor: lastPageEntry ? String(lastPageEntry.id) : String(after), hasMore: rows.length > limit };
}

export function parseEntriesBeforeCursor(raw: string | undefined): number | null {
  // Absent/empty => newest page (no upper bound). A provided value must be a
  // positive integer id; anything else is rejected (fail closed).
  if (raw === undefined || raw === "") return Number.MAX_SAFE_INTEGER;
  if (!/^\d+$/.test(raw)) return null;
  const cursor = Number(raw);
  return Number.isSafeInteger(cursor) ? cursor : null;
}

/**
 * Newest-first page: rows are fetched `id < before ORDER BY id DESC LIMIT limit+1`
 * (cheap on idx_conversation_entries_session (session_id, id DESC)). We return
 * them RE-REVERSED to chronological order for direct render, plus `olderCursor`
 * (the smallest id in the page) to page further back, and `hasOlder` when more
 * history exists before this page. This is the P1 Stage-2 fast first paint: one
 * bounded page renders immediately instead of draining up to 20 oldest-first pages.
 */
export function pageConversationEntriesDesc(rows: ConversationEntryRow[], limit: number) {
  const hasOlder = rows.length > limit;
  const page = rows.slice(0, limit);           // newest-first, capped
  const chronological = [...page].reverse();   // oldest-first for render
  const entries = chronological.filter(isOwnerVisible).map(mapRow);
  const oldestPageEntry = page.at(-1);
  const olderCursor = oldestPageEntry ? String(oldestPageEntry.id) : null;
  return { entries, olderCursor, hasOlder };
}

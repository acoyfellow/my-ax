export type AttentionState = "unseen" | "seen";

export function attentionState(row: { seen_at: string | null }): AttentionState {
  return row.seen_at === null ? "unseen" : "seen";
}

export interface AttentionDb {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
}

function changedRows(result: unknown): number {
  const changes = (result as { meta?: { changes?: unknown } } | null)?.meta?.changes;
  return typeof changes === "number" ? changes : 0;
}

const MARK_SEEN = "UPDATE attention_items SET seen_at = datetime('now') WHERE owner_email = ? AND seen_at IS NULL";

export async function markAttentionSeen(db: AttentionDb, ownerEmail: string, scope: { ids?: readonly string[]; filterSql?: string; filterBinds?: readonly unknown[] } = {}): Promise<number> {
  if (scope.ids) {
    if (!scope.ids.length) return 0;
    const placeholders = scope.ids.map(() => "?").join(",");
    return changedRows(await db.prepare(`${MARK_SEEN} AND id IN (${placeholders})`).bind(ownerEmail, ...scope.ids).run());
  }
  if (scope.filterSql) return changedRows(await db.prepare(`${MARK_SEEN}${scope.filterSql}`).bind(ownerEmail, ...(scope.filterBinds ?? [])).run());
  return changedRows(await db.prepare(MARK_SEEN).bind(ownerEmail).run());
}

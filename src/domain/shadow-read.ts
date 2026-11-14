type ShadowDb = { prepare(sql: string): { bind(...values: unknown[]): { first?<T>(): Promise<T | null> } } };

const SHADOW_TABLES = new Set(["sessions", "runs", "saved_recipes", "jobs"]);

export async function shadowReadStatus(db: ShadowDb, table: string, id: string, ownerEmail: string): Promise<string | null | undefined> {
  if (!SHADOW_TABLES.has(table)) return undefined;
  try {
    const statement = db.prepare(`SELECT status FROM ${table} WHERE id = ? AND owner_email = ?`).bind(id, ownerEmail);
    if (typeof statement.first !== "function") return undefined;
    const row = await statement.first<{ status: string }>();
    return row?.status ?? null;
  } catch {
    return undefined;
  }
}

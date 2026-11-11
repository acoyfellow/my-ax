export type AliasDb = {
  prepare(sql: string): { bind(...values: unknown[]): { first<T = unknown>(): Promise<T | null> } };
};

export async function resolveSessionAlias(db: AliasDb, email: string, id: string): Promise<string> {
  if (id !== "root") return id;
  const row = await db.prepare("SELECT id FROM sessions WHERE owner_email = ? AND stable_name = 'root'").bind(email).first<{ id: string }>();
  if (!row) throw new Error("root session does not exist yet; open my.ax once to create it");
  return row.id;
}

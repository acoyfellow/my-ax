export function amberEnabled(env: { AMBER_ENABLED?: string }): boolean {
  return env.AMBER_ENABLED === "1";
}

export async function setAmber(db: { prepare: (sql: string) => { bind: (...b: unknown[]) => { run: () => Promise<unknown> } } }, sessionId: string, ownerEmail: string, amber: boolean): Promise<boolean> {
  const result = await db.prepare("UPDATE sessions SET amber = ? WHERE id = ? AND owner_email = ?").bind(amber ? 1 : 0, sessionId, ownerEmail).run() as { meta?: { changes?: number } };
  return (result.meta?.changes ?? 0) === 1;
}

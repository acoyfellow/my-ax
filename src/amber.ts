import { SESSION_SQL, sessionWrite, type SessionStoreDb } from "./domain/Session/Session.store";
export function amberEnabled(env: { AMBER_ENABLED?: string }): boolean {
  return env.AMBER_ENABLED === "1";
}

export async function setAmber(db: { prepare: (sql: string) => { bind: (...b: unknown[]) => { run: () => Promise<unknown> } } }, sessionId: string, ownerEmail: string, amber: boolean): Promise<boolean> {
  const result = await sessionWrite(db as unknown as SessionStoreDb, SESSION_SQL.S13_AMBER, [amber ? 1 : 0, sessionId, ownerEmail]) as { meta?: { changes?: number } };
  return (result.meta?.changes ?? 0) === 1;
}

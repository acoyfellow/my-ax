export type Refusal = { aggregate: string; command: string; rejection: string };

const counts = new Map<string, number>();

export type RefusalSink = (tag: "domain.refused", refusal: Refusal) => void;

let sink: RefusalSink = (tag, refusal) => console.log(tag, JSON.stringify(refusal));

export function setRefusalSink(next: RefusalSink): RefusalSink {
  const previous = sink;
  sink = next;
  return previous;
}

export function recordRefusal(refusal: Refusal): void {
  const key = `${refusal.aggregate}.${refusal.command}.${refusal.rejection}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
  try {
    sink("domain.refused", refusal);
  } catch {
    return;
  }
}

export function refusalCounts(): Record<string, number> {
  return Object.fromEntries(counts);
}

export function resetRefusalCounts(): void {
  counts.clear();
}

type RefusalDb = { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; all<T>(): Promise<{ results?: T[] }> } } };

const FLUSH_SQL = "INSERT INTO domain_refusals (day, refusal_key, count) VALUES (?, ?, ?) ON CONFLICT(day, refusal_key) DO UPDATE SET count = count + excluded.count";

export async function flushRefusals(db: RefusalDb, now: Date = new Date()): Promise<number> {
  const pending = [...counts];
  counts.clear();
  const day = now.toISOString().slice(0, 10);
  for (const [key, count] of pending) await db.prepare(FLUSH_SQL).bind(day, key, count).run();
  return pending.length;
}

export async function dailyRefusals(db: RefusalDb, day: string): Promise<Record<string, number>> {
  const rows = await db.prepare("SELECT refusal_key, count FROM domain_refusals WHERE day = ? ORDER BY count DESC").bind(day).all<{ refusal_key: string; count: number }>();
  return Object.fromEntries((rows.results ?? []).map((row) => [row.refusal_key, row.count]));
}

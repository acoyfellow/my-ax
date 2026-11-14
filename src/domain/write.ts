import { decide } from "./decide";

type Statement = { run(): Promise<{ meta?: { changes?: number } } | unknown> };
type Bound = { bind(...values: unknown[]): Statement };
export type WriteDb = { prepare(sql: string): Bound; batch?(statements: Statement[]): Promise<unknown> };

type Predicts = Parameters<typeof decide>[0];

export type DomainWrite = {
  aggregate: Predicts;
  id: string;
  state: unknown;
  command: { readonly _tag: string };
  sql: string;
  binds: readonly unknown[];
};

export async function domainWrite(db: WriteDb, write: DomainWrite) {
  decide(write.aggregate, write.id, write.state, write.command);
  return db.prepare(write.sql).bind(...write.binds).run();
}

export function domainStatement(db: WriteDb, write: DomainWrite): Statement {
  decide(write.aggregate, write.id, write.state, write.command);
  return db.prepare(write.sql).bind(...write.binds);
}

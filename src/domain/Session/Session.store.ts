import { Effect } from "effect";
import { Database, type DatabaseError } from "../../effect/database";
import { decide, DomainRejected } from "../decide";
import { shadowSession, safely } from "../shadow";
import * as Commands from "./commands";
import { DeleteSession } from "./DeleteSession.command";
import { OpenSession } from "./OpenSession.command";
import { Session, type SessionCommandName, type SessionStage } from "./Session.aggregate";
import { UpdateSessionDetails, type SessionDetail } from "./UpdateSessionDetails.command";

type Statement = { run(): Promise<unknown>; first?<T>(): Promise<T | null> };
export type SessionStoreDb = { prepare(sql: string): { bind(...values: unknown[]): Statement } };

export type SessionWriteKind = "open" | "delete" | SessionDetail;
export type SessionSqlEntry = { sql: string; kind: SessionWriteKind; id: number; owner: number | null; name: number | null };
export type SessionWriteResult = { success: boolean; meta: { changes: number } };

type SessionRow = { status: string; name: string | null; owner_email: string };

const REFUSED: SessionWriteResult = { success: true, meta: { changes: 0 } };

export const SESSION_SQL = {
  S01_OPEN: { sql: "INSERT INTO sessions (id, name, status, owner_email, engine, created_at, updated_at) VALUES (?, ?, 'active', ?, 'pi', datetime('now'), datetime('now'))", kind: "open", id: 0, owner: 2, name: 1 },
  S02_DELETE: { sql: "DELETE FROM sessions WHERE id = ? AND owner_email = ?", kind: "delete", id: 0, owner: 1, name: null },
  S03_ENGINE: { sql: "UPDATE sessions SET engine = 'pi' WHERE id = ? AND owner_email = ?", kind: "engine", id: 0, owner: 1, name: null },
  S04_TOUCH: { sql: "UPDATE sessions SET updated_at = datetime('now'), name = CASE WHEN name IN ('New chat', 'Pi chat') THEN ? ELSE name END WHERE id = ?", kind: "touch", id: 1, owner: null, name: null },
  S05_OPEN: { sql: "INSERT INTO sessions (id, name, status, owner_email, engine, parent_id, created_at, updated_at) VALUES (?, ?, 'active', ?, 'pi', ?, datetime('now'), datetime('now'))", kind: "open", id: 0, owner: 2, name: 1 },
  S06_OPEN: { sql: "INSERT INTO sessions (id, name, status, owner_email, engine, created_at, updated_at) VALUES (?, ?, 'active', ?, 'pi', ?, ?)", kind: "open", id: 0, owner: 2, name: 1 },
  S07_OPEN: { sql: "INSERT INTO sessions (id, name, stable_name, status, owner_email, engine, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, 'pi', datetime('now'), datetime('now'))", kind: "open", id: 0, owner: 3, name: 1 },
  S08_NAME: { sql: "UPDATE sessions SET name = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ?", kind: "name", id: 1, owner: 2, name: 0 },
  S09_TOUCH: { sql: "UPDATE sessions SET updated_at = datetime('now') WHERE id = ? AND owner_email = ?", kind: "touch", id: 0, owner: 1, name: null },
  S10_OPEN: { sql: "INSERT INTO sessions (id, name, status, owner_email, engine) VALUES (?, ?, 'running', ?, 'pi')", kind: "open", id: 0, owner: 2, name: 1 },
  S11_PIN: { sql: "UPDATE sessions SET pin_size = ? WHERE id = ? AND owner_email = ? AND pinned = 1", kind: "pin", id: 1, owner: 2, name: null },
  S12_OPEN: { sql: "INSERT INTO sessions (id, name, stable_name, status, owner_email, engine, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, 'pi', datetime('now'), datetime('now')) ON CONFLICT(owner_email, stable_name) WHERE stable_name IS NOT NULL DO NOTHING", kind: "open", id: 0, owner: 3, name: 1 },
  S13_AMBER: { sql: "UPDATE sessions SET amber = ? WHERE id = ? AND owner_email = ?", kind: "amber", id: 1, owner: 2, name: null },
  S14_PIN: { sql: "UPDATE sessions SET pinned = 1, pin_rank = ?, pin_updated_at = datetime('now') WHERE id = ? AND owner_email = ?", kind: "pin", id: 1, owner: 2, name: null },
  S15_PIN: { sql: "UPDATE sessions SET pinned = 0, pin_rank = NULL, pin_updated_at = datetime('now') WHERE id = ? AND owner_email = ?", kind: "pin", id: 0, owner: 1, name: null },
  S16_PIN: { sql: "UPDATE sessions SET pin_rank = ?, pin_updated_at = datetime('now') WHERE id = ? AND owner_email = ? AND pinned = 1", kind: "pin", id: 1, owner: 2, name: null },
  S17_STYLE: { sql: "UPDATE sessions SET convo_style = ? WHERE id = ? AND owner_email = ?", kind: "style", id: 1, owner: 2, name: null },
} as const satisfies Record<string, SessionSqlEntry>;

const stageOf = (status: string): SessionStage => (status.charAt(0).toUpperCase() + status.slice(1)) as SessionStage;

function sessionStateOf(row: SessionRow | null) {
  if (!row) return { _tag: "Unopened" as const };
  return { _tag: "Open" as const, ownerEmail: row.owner_email ?? "", name: row.name ?? "", stage: stageOf(row.status ?? "active") };
}

function loadSql(entry: SessionSqlEntry): string {
  return entry.owner === null ? "SELECT * FROM sessions WHERE id = ?" : "SELECT * FROM sessions WHERE id = ? AND owner_email = ?";
}

function loadBinds(entry: SessionSqlEntry, binds: readonly unknown[]): unknown[] {
  return entry.owner === null ? [binds[entry.id]] : [binds[entry.id], binds[entry.owner]];
}

function commandFor(entry: SessionSqlEntry, binds: readonly unknown[]) {
  if (entry.kind === "open") return new OpenSession({ ownerEmail: String(binds[entry.owner ?? 0] ?? ""), name: String(binds[entry.name ?? 0] ?? "") });
  if (entry.kind === "delete") return new DeleteSession();
  return new UpdateSessionDetails({ detail: entry.kind, name: entry.name === null ? null : String(binds[entry.name]) });
}

function allowed(entry: SessionSqlEntry, binds: readonly unknown[], row: SessionRow | null): boolean {
  try {
    decide(Session, String(binds[entry.id]), sessionStateOf(row), commandFor(entry, binds));
    return true;
  } catch (error) {
    if (error instanceof DomainRejected) return false;
    throw error;
  }
}

async function loadRow(db: SessionStoreDb, entry: SessionSqlEntry, binds: readonly unknown[]): Promise<SessionRow | null | undefined> {
  if (entry.kind === "open") return null;
  const statement = db.prepare(loadSql(entry)).bind(...loadBinds(entry, binds));
  if (typeof statement.first !== "function") return undefined;
  return statement.first<SessionRow>();
}

export async function sessionWrite(db: SessionStoreDb, entry: SessionSqlEntry, binds: readonly unknown[]): Promise<SessionWriteResult> {
  const row = await loadRow(db, entry, binds);
  if (row !== undefined && !allowed(entry, binds, row)) return REFUSED;
  return (await db.prepare(entry.sql).bind(...binds).run()) as SessionWriteResult;
}

export function sessionWriteEffect(entry: SessionSqlEntry, binds: readonly unknown[]): Effect.Effect<boolean, DatabaseError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const row = entry.kind === "open" ? null : yield* database.first<SessionRow>(loadSql(entry), loadBinds(entry, binds));
    if (!allowed(entry, binds, row)) return false;
    yield* database.run(entry.sql, [...binds]);
    return true;
  });
}

export type SessionTransition = { command: SessionCommandName; sql: string; to: string; from: readonly string[] };

export function sessionStatusStatement(transition: { from: readonly string[]; to: string; touchUpdatedAt: boolean }): { sql: string; to: string; from: readonly string[] } {
  const placeholders = transition.from.map(() => "?").join(", ");
  const updatedAt = transition.touchUpdatedAt ? "datetime('now')" : "updated_at";
  return {
    sql: `UPDATE sessions SET status = ?, updated_at = ${updatedAt} WHERE id = ? AND owner_email = ? AND status IN (${placeholders})`,
    to: transition.to,
    from: transition.from,
  };
}

export async function transitionSessionRecord(db: SessionStoreDb, session: { id: string; ownerEmail: string }, event: string, transition: SessionTransition): Promise<boolean> {
  const statement = db.prepare("SELECT * FROM sessions WHERE id = ? AND owner_email = ?").bind(session.id, session.ownerEmail);
  const row = typeof statement.first === "function" ? await statement.first<SessionRow>().catch(() => undefined) : undefined;
  if (row !== undefined) {
    try {
      decide(Session, session.id, sessionStateOf(row), new Commands.ALL[transition.command]() as { readonly _tag: string });
    } catch (error) {
      if (!(error instanceof DomainRejected)) throw error;
      safely(() => shadowSession(event, session.ownerEmail, row?.status ?? null, "rejected"));
      return false;
    }
  }
  const result = await db.prepare(transition.sql).bind(transition.to, session.id, session.ownerEmail, ...transition.from).run();
  const changes = (result as { meta?: { changes?: unknown } } | null)?.meta?.changes;
  const applied = typeof changes === "number" && changes > 0;
  if (row !== undefined) safely(() => shadowSession(event, session.ownerEmail, row?.status ?? null, applied ? "accepted" : "rejected"));
  return applied;
}

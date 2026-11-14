import { Effect } from "effect";
import { Database, type DatabaseError } from "../../effect/database";
import { decide, DomainRejected } from "../decide";
import { Run, type RunStage } from "./Run.aggregate";
import { DismissRun } from "./DismissRun.command";
import { StartRun } from "./StartRun.command";
import * as RunCommands from "./commands";
import type { RunCommandName } from "./Run.aggregate";
import { RUN_COMMAND, safely, shadowRun } from "../shadow";

const EVENT_FOR = Object.fromEntries(Object.entries(RUN_COMMAND).map(([event, command]) => [command, event])) as Record<RunCommandName, string>;

function audit(command: RunCommandName, ownerEmail: string, status: RunRowStatus, verdict: "accepted" | "rejected"): void {
  safely(() => shadowRun(EVENT_FOR[command], ownerEmail, status, verdict));
}

type Statement = { run(): Promise<unknown>; first?<T>(): Promise<T | null>; all?<T>(): Promise<{ results?: T[] }> };
export type RunStoreDb = { prepare(sql: string): { bind(...values: unknown[]): Statement } };

export type RunRowStatus = "open" | "running" | "completed" | "failed" | "aborted";

const STAGE: Record<RunRowStatus, RunStage> = { open: "Open", running: "Running", completed: "Completed", failed: "Failed", aborted: "Aborted" };
const changed = (result: unknown) => {
  const changes = (result as { meta?: { changes?: unknown } } | null)?.meta?.changes;
  return typeof changes === "number" ? changes : 0;
};

const present = (ownerEmail: string, status: RunRowStatus) => ({ _tag: "Present" as const, ownerEmail, stage: STAGE[status] });

async function currentStatus(db: RunStoreDb, id: string, ownerEmail: string): Promise<RunRowStatus | null | undefined> {
  const statement = db.prepare("SELECT status FROM runs WHERE id = ? AND owner_email = ?").bind(id, ownerEmail);
  if (!statement.first) return undefined;
  const row = await statement.first<{ status: RunRowStatus }>();
  return row ? row.status : null;
}

export type NewRun = { id: string; ownerEmail: string; sessionId: string | null; status: RunRowStatus; title: string; taskSummary: string; boundsJson: string; createdAt: string | null };

export async function startRunRecord(db: RunStoreDb, run: NewRun): Promise<void> {
  decide(Run, run.id, { _tag: "Missing" }, new StartRun({ ownerEmail: run.ownerEmail, stage: STAGE[run.status] }));
  if (run.createdAt === null) {
    await db.prepare("INSERT INTO runs(id, owner_email, session_id, status, title, task_summary, bounds_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))")
      .bind(run.id, run.ownerEmail, run.sessionId, run.status, run.title, run.taskSummary, run.boundsJson).run();
    return;
  }
  await db.prepare("INSERT INTO runs (id, owner_email, session_id, status, title, task_summary, bounds_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(run.id, run.ownerEmail, run.sessionId, run.status, run.title, run.taskSummary, run.boundsJson, run.createdAt, run.createdAt).run();
}

export type RunTransitionSql = { sql: string; binds: unknown[] };

export function guardedRunTransition(to: RunRowStatus, from: readonly RunRowStatus[], id: string, ownerEmail: string): RunTransitionSql {
  const placeholders = from.map(() => "?").join(", ");
  return {
    sql: `UPDATE runs SET status = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ? AND status IN (${placeholders})`,
    binds: [to, id, ownerEmail, ...from],
  };
}

export function recordReceiptEffect(runId: string, ownerEmail: string): Effect.Effect<void, DatabaseError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const row = yield* database.first<{ status: RunRowStatus }>("SELECT status FROM runs WHERE id = ? AND owner_email = ?", [runId, ownerEmail]);
    if (!row || row.status !== "open") return;
    decide(Run, runId, present(ownerEmail, row.status), new RunCommands.ALL.RecordReceipt() as { readonly _tag: string });
    const guarded = guardedRunTransition("running", ["open"], runId, ownerEmail);
    yield* database.run(guarded.sql, guarded.binds);
  });
}

export async function transitionRunRecord(db: RunStoreDb, id: string, ownerEmail: string, command: RunCommandName, guarded: RunTransitionSql): Promise<boolean> {
  const status = await currentStatus(db, id, ownerEmail);
  if (status === null) return false;
  if (status !== undefined) {
    try {
      decide(Run, id, present(ownerEmail, status), new RunCommands.ALL[command]() as { readonly _tag: string });
    } catch (error) {
      if (!(error instanceof DomainRejected)) throw error;
      audit(command, ownerEmail, status, "rejected");
      return false;
    }
  }
  const applied = changed(await db.prepare(guarded.sql).bind(...guarded.binds).run()) > 0;
  if (status !== undefined) audit(command, ownerEmail, status, applied ? "accepted" : "rejected");
  return applied;
}

export async function dismissRunRecord(db: RunStoreDb, id: string, ownerEmail: string): Promise<{ found: boolean; changed: boolean }> {
  const status = await currentStatus(db, id, ownerEmail);
  if (status === null) return { found: false, changed: false };
  if (status !== undefined) decide(Run, id, present(ownerEmail, status), new DismissRun());
  const result = await db.prepare("UPDATE runs SET dismissed_at = datetime('now') WHERE id = ? AND owner_email = ? AND dismissed_at IS NULL").bind(id, ownerEmail).run();
  return { found: true, changed: changed(result) > 0 };
}

export async function dismissRunRecords(db: RunStoreDb, ownerEmail: string, status: RunRowStatus | null): Promise<number> {
  const select = status
    ? db.prepare("SELECT id, status FROM runs WHERE owner_email = ? AND status = ? AND dismissed_at IS NULL").bind(ownerEmail, status)
    : db.prepare("SELECT id, status FROM runs WHERE owner_email = ? AND dismissed_at IS NULL").bind(ownerEmail);
  const rows = select.all ? ((await select.all<{ id: string; status: RunRowStatus }>()).results ?? []) : [];
  for (const row of rows) decide(Run, row.id, present(ownerEmail, row.status), new DismissRun());
  const result = status
    ? await db.prepare("UPDATE runs SET dismissed_at = datetime('now') WHERE owner_email = ? AND status = ? AND dismissed_at IS NULL").bind(ownerEmail, status).run()
    : await db.prepare("UPDATE runs SET dismissed_at = datetime('now') WHERE owner_email = ? AND dismissed_at IS NULL").bind(ownerEmail).run();
  return changed(result);
}

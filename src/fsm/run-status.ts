export type RunStatus = "open" | "running" | "completed" | "failed" | "aborted";

export type RunStatusEvent =
  | "receipt_recorded"
  | "recipe_succeeded"
  | "recipe_failed"
  | "decision_answered"
  | "decision_reopened"
  | "decision_superseded"
  | "owner_completed"
  | "owner_failed"
  | "owner_aborted";

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ["completed", "failed", "aborted"];
const LIVE: readonly RunStatus[] = ["open", "running"];

type Transition = { from: readonly RunStatus[]; to: RunStatus };

export const RUN_TRANSITIONS: Readonly<Record<RunStatusEvent, Transition>> = {
  receipt_recorded: { from: ["open"], to: "running" },
  recipe_succeeded: { from: ["running"], to: "completed" },
  recipe_failed: { from: ["running"], to: "failed" },
  decision_answered: { from: ["open"], to: "completed" },
  decision_reopened: { from: ["completed"], to: "open" },
  decision_superseded: { from: ["open"], to: "aborted" },
  owner_completed: { from: LIVE, to: "completed" },
  owner_failed: { from: LIVE, to: "failed" },
  owner_aborted: { from: LIVE, to: "aborted" },
};

export function ownerTerminalEvent(status: RunStatus): RunStatusEvent {
  if (status === "failed") return "owner_failed";
  if (status === "aborted") return "owner_aborted";
  return "owner_completed";
}

const RIG_TERMINAL_EVENTS: Readonly<Record<string, RunStatusEvent>> = {
  "rig.rejected": "owner_aborted",
  "rig.failed": "owner_failed",
  "rig.deployed": "owner_completed",
  "rig.verified": "owner_completed",
};

export function rigRunEvent(receiptType: string): RunStatusEvent | null {
  return RIG_TERMINAL_EVENTS[receiptType] ?? null;
}

export function nextRunStatus(current: RunStatus, event: RunStatusEvent): RunStatus | null {
  const transition = RUN_TRANSITIONS[event];
  return transition.from.includes(current) ? transition.to : null;
}

export function runStatusStatement(event: RunStatusEvent): { sql: string; binds: (id: string, ownerEmail: string) => unknown[] } {
  const transition = RUN_TRANSITIONS[event];
  const placeholders = transition.from.map(() => "?").join(", ");
  return {
    sql: `UPDATE runs SET status = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ? AND status IN (${placeholders})`,
    binds: (id, ownerEmail) => [transition.to, id, ownerEmail, ...transition.from],
  };
}

export interface RunStatusDb {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
}

export async function applyRunEvent(db: RunStatusDb, run: { id: string; ownerEmail: string }, event: RunStatusEvent): Promise<boolean> {
  const statement = runStatusStatement(event);
  const result = await db.prepare(statement.sql).bind(...statement.binds(run.id, run.ownerEmail)).run();
  const changes = (result as { meta?: { changes?: unknown } } | null)?.meta?.changes;
  return typeof changes === "number" && changes > 0;
}

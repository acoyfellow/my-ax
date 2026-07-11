import type { JobRow } from "./jobs";

export interface JobStateTransitionDeps {
  schedule(row: JobRow): Promise<string>;
  cancel(row: JobRow): Promise<void>;
  persist(row: JobRow): Promise<void>;
  nextRun(row: JobRow): string;
}

/** Performs an idempotent pause/resume transition around the native schedule. */
export async function transitionJobPaused(row: JobRow, paused: boolean, deps: JobStateTransitionDeps): Promise<JobRow> {
  if (paused && row.status === "paused") return row;
  if (!paused && row.status === "active") return row;

  if (paused) {
    await deps.cancel(row);
    const updated = { ...row, status: "paused" as const, schedule_id: null };
    await deps.persist(updated);
    return updated;
  }

  const scheduleId = await deps.schedule(row);
  const scheduled = { ...row, status: "active" as const, schedule_id: scheduleId };
  try {
    // nextRun() must run INSIDE the try: it can throw on a malformed schedule
    // expression, and the native schedule is already created — so a failure
    // here must also trigger the compensating cancel, not leak an orphan.
    const updated = { ...scheduled, next_run_at: deps.nextRun(row) };
    await deps.persist(updated);
    return updated;
  } catch (error) {
    await deps.cancel(scheduled).catch(() => undefined);
    throw error;
  }
}

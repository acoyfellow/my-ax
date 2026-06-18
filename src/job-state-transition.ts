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
  const updated = {
    ...row,
    status: "active" as const,
    schedule_id: scheduleId,
    next_run_at: deps.nextRun(row),
  };
  try {
    await deps.persist(updated);
  } catch (error) {
    await deps.cancel(updated).catch(() => undefined);
    throw error;
  }
  return updated;
}

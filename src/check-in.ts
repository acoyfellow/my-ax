export interface CheckInSources {
  attention: Array<{ id: string; title: string; body: string; href: string; created_at: string }>;
  jobs: Array<{ id: string; name: string; status: string; next_run_at: string; last_error: string | null }>;
  runs: Array<{ id: string; title: string | null; task_summary: string; status: string; updated_at: string }>;
}

export interface OwnerCheckIn {
  summary: string;
  needsOwner: CheckInSources["attention"];
  completed: CheckInSources["runs"];
  failed: CheckInSources["runs"];
  running: {
    jobs: CheckInSources["jobs"];
    runs: CheckInSources["runs"];
  };
  suggestedSteers: Array<{ label: string; href: string }>;
}

/** Compose a compact owner read model from existing durable state. */
export function composeOwnerCheckIn(sources: CheckInSources): OwnerCheckIn {
  const needsOwner = sources.attention.slice(0, 10);
  const jobs = sources.jobs.filter((job) => job.status === "active").slice(0, 10);
  const openRuns = sources.runs.filter((run) => run.status === "open" || run.status === "running").slice(0, 10);
  const completed = sources.runs.filter((run) => run.status === "completed").slice(0, 10);
  const failed = sources.runs.filter((run) => run.status === "failed").slice(0, 10);
  const summary = needsOwner.length
    ? `${needsOwner.length} item${needsOwner.length === 1 ? " needs" : "s need"} your attention; ${jobs.length + openRuns.length} active.`
    : failed.length
      ? `${failed.length} failed run${failed.length === 1 ? " needs" : "s need"} review; ${jobs.length + openRuns.length} active.`
      : `${jobs.length + openRuns.length} active; ${completed.length} recently completed.`;
  const suggestedSteers: OwnerCheckIn["suggestedSteers"] = needsOwner.length
    ? [{ label: "Review attention", href: needsOwner[0].href || "/" }]
    : failed.length
      ? [{ label: "Review failed work", href: `/api/runs/${encodeURIComponent(failed[0].id)}` }]
      : openRuns.length
        ? [{ label: "Review running work", href: `/api/runs/${encodeURIComponent(openRuns[0].id)}` }]
        : jobs.length
          ? [{ label: "Review recurring jobs", href: "/api/jobs" }]
          : [{ label: "Start a conversation", href: "/" }];
  return { summary, needsOwner, completed, failed, running: { jobs, runs: openRuns }, suggestedSteers };
}

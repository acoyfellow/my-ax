export interface CheckInSources {
  attention: Array<{ id: string; title: string; body: string; href: string; created_at: string; kind?: string | null; session_id?: string | null }>;
  jobs: Array<{ id: string; name: string; status: string; next_run_at: string; last_error: string | null }>;
  runs: Array<{ id: string; title: string | null; task_summary: string; status: string; updated_at: string }>;
  totals?: Partial<Record<"attention" | "activeJobs" | "openRuns" | "completedRuns" | "failedRuns", number>>;
  deployment?: { versionId: string | null; versionTag?: string | null; versionTimestamp: string | null };
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
  deployment: { versionId: string | null; versionTag: string | null; versionTimestamp: string | null };
  totals: {
    attention: number;
    activeJobs: number;
    openRuns: number;
    completedRuns: number;
    failedRuns: number;
  };
}

/** Compose a compact owner read model from existing durable state. */
export function composeOwnerCheckIn(sources: CheckInSources): OwnerCheckIn {
  const needsOwner = sources.attention.slice(0, 10);
  const jobs = sources.jobs.filter((job) => job.status === "active").slice(0, 10);
  const openRuns = sources.runs.filter((run) => run.status === "open" || run.status === "running").slice(0, 10);
  const completed = sources.runs.filter((run) => run.status === "completed").slice(0, 10);
  const failed = sources.runs.filter((run) => run.status === "failed").slice(0, 10);
  const totals = {
    attention: sources.totals?.attention ?? needsOwner.length,
    activeJobs: sources.totals?.activeJobs ?? jobs.length,
    openRuns: sources.totals?.openRuns ?? openRuns.length,
    completedRuns: sources.totals?.completedRuns ?? completed.length,
    failedRuns: sources.totals?.failedRuns ?? failed.length,
  };
  const activeTotal = totals.activeJobs + totals.openRuns;
  const summary = totals.attention > 0
    ? `${totals.attention} item${totals.attention === 1 ? " needs" : "s need"} your attention; ${activeTotal} active.`
    : totals.failedRuns > 0
      ? `${totals.failedRuns} failed run${totals.failedRuns === 1 ? " needs" : "s need"} review; ${activeTotal} active.`
      : `${activeTotal} active; ${totals.completedRuns} recently completed.`;
  const attentionKind = needsOwner.find((item) => item.kind)?.kind ?? null;
  const suggestedSteers: OwnerCheckIn["suggestedSteers"] = [];
  const addSteer = (steer: OwnerCheckIn["suggestedSteers"][number]) => {
    if (!suggestedSteers.some((existing) => existing.href === steer.href)) suggestedSteers.push(steer);
  };
  if (needsOwner.length) {
    addSteer({
      label: attentionKind ? `Review ${attentionKind} attention` : "Review attention",
      href: attentionKind ? `/api/attention?kind=${encodeURIComponent(attentionKind)}` : (needsOwner[0].href || "/"),
    });
  }
  if (totals.failedRuns > 0) addSteer({ label: "Review failed work", href: "/api/runs?status=failed" });
  if (openRuns.length) {
    const workStatus = openRuns[0].status === "open" ? "open" : "running";
    addSteer({ label: `Review ${workStatus} work`, href: `/api/runs?status=${workStatus}` });
  }
  if (totals.activeJobs > 0) addSteer({ label: "Review active recurring jobs", href: "/api/jobs?status=active" });
  if (!suggestedSteers.length) addSteer({ label: "Start a conversation", href: "/" });
  const deployment = {
    versionId: sources.deployment?.versionId ?? null,
    versionTag: sources.deployment?.versionTag ?? null,
    versionTimestamp: sources.deployment?.versionTimestamp ?? null,
  };
  return { summary, needsOwner, completed, failed, running: { jobs, runs: openRuns }, suggestedSteers, deployment, totals };
}

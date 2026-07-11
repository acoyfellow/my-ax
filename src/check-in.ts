import { isActionableNotificationKind } from "./notify";

export interface CheckInSources {
  attention: Array<{ id: string; title: string; body: string; href: string; created_at: string; kind?: string | null; session_id?: string | null }>;
  informationalAttention?: CheckInSources["attention"];
  jobs: Array<{ id: string; name: string; status: string; next_run_at: string; last_error: string | null }>;
  runs: Array<{ id: string; title: string | null; task_summary: string; status: string; updated_at: string }>;
  totals?: Partial<Record<"attention" | "attentionActionable" | "attentionInformational" | "activeJobs" | "openRuns" | "completedRuns" | "failedRuns", number>>;
  deployment?: { versionId: string | null; versionTag?: string | null; versionTimestamp: string | null };
  checkedAt?: string;
}

type CheckInSteer = { label: string; href: string };
type CheckInBucketKey = "attention" | "informationalAttention" | "failedRuns" | "openRuns" | "activeJobs" | "completedRuns";
type CheckInBucket = { key: CheckInBucketKey; label: string; total: number; sampleCount: number; sampleIds: string[]; steer: CheckInSteer | null };

export interface OwnerCheckIn {
  summary: string;
  /** Actionable unread items only. Drives the headline. */
  needsOwner: CheckInSources["attention"];
  /** Non-actionable / unknown-kind unread items. Visible but excluded from the headline. */
  informationalUpdates: CheckInSources["attention"];
  completed: CheckInSources["runs"];
  failed: CheckInSources["runs"];
  running: {
    jobs: CheckInSources["jobs"];
    runs: CheckInSources["runs"];
  };
  suggestedSteers: CheckInSteer[];
  buckets: CheckInBucket[];
  deployment: { versionId: string | null; versionTag: string | null; versionTimestamp: string | null };
  checkedAt: string;
  totals: {
    /** Total unread attention (actionable + informational). Preserved for legacy consumers. */
    attention: number;
    attentionActionable: number;
    attentionInformational: number;
    activeJobs: number;
    openRuns: number;
    completedRuns: number;
    failedRuns: number;
  };
}

/** Compose a compact owner read model from existing durable state. */
export function composeOwnerCheckIn(sources: CheckInSources): OwnerCheckIn {
  // Partition mode:
  //   A. explicit pre-split: caller supplied `informationalAttention`. The two
  //      arrays are treated as authoritative partitions of the sample.
  //   B. legacy: caller supplied only `totals.attention` (no split totals, no
  //      pre-split sample). Preserve the pre-split contract — everything is
  //      actionable so `attentionActionable + attentionInformational` still
  //      equals `attention` and the headline count matches the sample.
  //   C. classify locally: no legacy total flag — use the pure predicate on
  //      each row so naive callers (tests, future producers) still get the
  //      split without needing to pre-partition.
  const hasPreSplit = Array.isArray(sources.informationalAttention);
  const providedAttention = sources.totals?.attention;
  const providedActionable = sources.totals?.attentionActionable;
  const providedInformational = sources.totals?.attentionInformational;
  const legacyMode = !hasPreSplit
    && providedAttention !== undefined
    && providedActionable === undefined
    && providedInformational === undefined;

  let actionableSampleRaw: CheckInSources["attention"];
  let informationalSampleRaw: CheckInSources["attention"];
  if (hasPreSplit) {
    actionableSampleRaw = sources.attention;
    informationalSampleRaw = sources.informationalAttention!;
  } else if (legacyMode) {
    actionableSampleRaw = sources.attention;
    informationalSampleRaw = [];
  } else {
    actionableSampleRaw = sources.attention.filter((item) => isActionableNotificationKind(item.kind ?? null));
    informationalSampleRaw = sources.attention.filter((item) => !isActionableNotificationKind(item.kind ?? null));
  }
  const needsOwner = actionableSampleRaw.slice(0, 10);
  const informationalUpdates = informationalSampleRaw.slice(0, 10);

  const jobs = sources.jobs.filter((job) => job.status === "active").slice(0, 10);
  const openRuns = sources.runs.filter((run) => run.status === "open" || run.status === "running").slice(0, 10);
  const completed = sources.runs.filter((run) => run.status === "completed").slice(0, 10);
  const failed = sources.runs.filter((run) => run.status === "failed").slice(0, 10);

  // Totals derivation. Capped samples must never make totals lie: we only use
  // sample lengths as fallbacks when no authoritative count was provided.
  let totalActionable: number;
  let totalInformational: number;
  let totalAttention: number;
  if (providedActionable !== undefined || providedInformational !== undefined) {
    totalActionable = providedActionable ?? actionableSampleRaw.length;
    totalInformational = providedInformational ?? informationalSampleRaw.length;
    totalAttention = providedAttention ?? (totalActionable + totalInformational);
  } else if (legacyMode) {
    totalAttention = providedAttention!;
    totalActionable = providedAttention!;
    totalInformational = 0;
  } else {
    // Fall back to the UNCAPPED partition sizes, not the sliced samples — using
    // needsOwner/informationalUpdates.length here caps the reported total at 10
    // and makes the totals lie (11 actionable rows would report 10).
    totalActionable = actionableSampleRaw.length;
    totalInformational = informationalSampleRaw.length;
    totalAttention = totalActionable + totalInformational;
  }

  const totals = {
    attention: totalAttention,
    attentionActionable: totalActionable,
    attentionInformational: totalInformational,
    activeJobs: sources.totals?.activeJobs ?? jobs.length,
    openRuns: sources.totals?.openRuns ?? openRuns.length,
    completedRuns: sources.totals?.completedRuns ?? completed.length,
    failedRuns: sources.totals?.failedRuns ?? failed.length,
  };

  const activeTotal = totals.activeJobs + totals.openRuns;
  const summary = totals.attentionActionable > 0
    ? (totals.attentionInformational > 0
        ? `${totals.attentionActionable} item${totals.attentionActionable === 1 ? " needs" : "s need"} your attention; ${totals.attentionInformational} update${totals.attentionInformational === 1 ? "" : "s"} awaiting review; ${activeTotal} active.`
        : `${totals.attentionActionable} item${totals.attentionActionable === 1 ? " needs" : "s need"} your attention; ${activeTotal} active.`)
    : totals.failedRuns > 0
      ? (totals.attentionInformational > 0
          ? `${totals.failedRuns} failed run${totals.failedRuns === 1 ? " needs" : "s need"} review; ${totals.attentionInformational} update${totals.attentionInformational === 1 ? "" : "s"} awaiting review; ${activeTotal} active.`
          : `${totals.failedRuns} failed run${totals.failedRuns === 1 ? " needs" : "s need"} review; ${activeTotal} active.`)
      : totals.attentionInformational > 0
        ? `0 items need your attention; ${totals.attentionInformational} update${totals.attentionInformational === 1 ? "" : "s"} awaiting review; ${activeTotal} active.`
        : `${activeTotal} active; ${totals.completedRuns} recently completed.`;

  const attentionKind = needsOwner.find((item) => item.kind)?.kind ?? null;
  const informationalKind = informationalUpdates.find((item) => item.kind)?.kind ?? null;

  const suggestedSteers: OwnerCheckIn["suggestedSteers"] = [];
  const steersByKey: Partial<Record<CheckInBucketKey, CheckInSteer>> = {};
  const addSteer = (steer: CheckInSteer) => {
    if (!suggestedSteers.some((existing) => existing.href === steer.href)) suggestedSteers.push(steer);
  };
  if (needsOwner.length) {
    const steer = {
      label: attentionKind ? `Review ${attentionKind} attention` : "Review attention",
      href: attentionKind ? `/api/attention?kind=${encodeURIComponent(attentionKind)}` : (needsOwner[0].href || "/"),
    };
    steersByKey.attention = steer;
    addSteer(steer);
  }
  if (totals.failedRuns > 0) {
    const steer = { label: "Review failed work", href: "/api/runs?status=failed" };
    steersByKey.failedRuns = steer;
    addSteer(steer);
  }
  if (openRuns.length) {
    const workStatus = openRuns[0].status === "open" ? "open" : "running";
    const steer = { label: `Review ${workStatus} work`, href: `/api/runs?status=${workStatus}` };
    steersByKey.openRuns = steer;
    addSteer(steer);
  }
  if (totals.activeJobs > 0) {
    const steer = { label: "Review active recurring jobs", href: "/api/jobs?status=active" };
    steersByKey.activeJobs = steer;
    addSteer(steer);
  }
  if (informationalUpdates.length) {
    const steer = {
      label: informationalKind ? `Review ${informationalKind} updates` : "Review updates",
      href: informationalKind ? `/api/attention?kind=${encodeURIComponent(informationalKind)}` : "/api/attention",
    };
    steersByKey.informationalAttention = steer;
    addSteer(steer);
  }
  if (!suggestedSteers.length) addSteer({ label: "Start a conversation", href: "/" });

  const buckets: CheckInBucket[] = [
    { key: "attention", label: "Attention", total: totals.attentionActionable, sampleCount: needsOwner.length, sampleIds: needsOwner.map((item) => item.id), steer: steersByKey.attention ?? null },
    { key: "failedRuns", label: "Failed runs", total: totals.failedRuns, sampleCount: failed.length, sampleIds: failed.map((run) => run.id), steer: steersByKey.failedRuns ?? null },
    { key: "openRuns", label: "Open/running runs", total: totals.openRuns, sampleCount: openRuns.length, sampleIds: openRuns.map((run) => run.id), steer: steersByKey.openRuns ?? null },
    { key: "activeJobs", label: "Active recurring jobs", total: totals.activeJobs, sampleCount: jobs.length, sampleIds: jobs.map((job) => job.id), steer: steersByKey.activeJobs ?? null },
    { key: "informationalAttention", label: "Updates awaiting review", total: totals.attentionInformational, sampleCount: informationalUpdates.length, sampleIds: informationalUpdates.map((item) => item.id), steer: steersByKey.informationalAttention ?? null },
    { key: "completedRuns", label: "Recently completed runs", total: totals.completedRuns, sampleCount: completed.length, sampleIds: completed.map((run) => run.id), steer: null },
  ];
  const deployment = {
    versionId: sources.deployment?.versionId ?? null,
    versionTag: sources.deployment?.versionTag ?? null,
    versionTimestamp: sources.deployment?.versionTimestamp ?? null,
  };
  const checkedAt = sources.checkedAt ?? new Date().toISOString();
  return { summary, needsOwner, informationalUpdates, completed, failed, running: { jobs, runs: openRuns }, suggestedSteers, buckets, deployment, checkedAt, totals };
}

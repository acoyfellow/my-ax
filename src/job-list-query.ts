export type JobListRow = {
  id: string;
  name: string;
  status: string;
  cadence_secs?: number | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
};

export type JobListQuery = {
  status?: string;
  nameContains?: string;
  limit?: number;
  offset?: number;
};

export const JOB_LIST_DEFAULT_LIMIT = 50;
export const JOB_LIST_MAX_LIMIT = 200;

export function parseJobListQuery(args: Record<string, unknown>): JobListQuery {
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined);
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  return { status: text(args.status), nameContains: text(args.nameContains), limit: number(args.limit), offset: number(args.offset) };
}

export function queryJobList(rows: JobListRow[], query: JobListQuery) {
  const needle = query.nameContains?.toLowerCase();
  const matching = rows.filter((row) =>
    (!query.status || row.status === query.status) && (!needle || row.name.toLowerCase().includes(needle)),
  );
  const limit = Math.min(JOB_LIST_MAX_LIMIT, Math.max(1, query.limit ?? JOB_LIST_DEFAULT_LIMIT));
  const offset = Math.max(0, query.offset ?? 0);
  const page = matching.slice(offset, offset + limit).map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    cadence_secs: row.cadence_secs ?? null,
    last_run_at: row.last_run_at ?? null,
    next_run_at: row.next_run_at ?? null,
  }));
  return {
    jobs: page,
    totalJobs: rows.length,
    matchingJobs: matching.length,
    returned: page.length,
    offset,
    hasMore: offset + page.length < matching.length,
    coverage: `${page.length} of ${matching.length} matching jobs (${rows.length} total)`,
  };
}

// Owns: the model-facing view of `manage_jobs list` (filter, page, slim rows,
// and explicit coverage counts so "none found" claims state what was checked).
// Called by: the canonical `manage_jobs` Think tool.
// Does not own: job persistence, scheduling, or HTTP job routes.

import type { JobRow, JobStatus } from "./jobs";

export const JOB_LIST_DEFAULT_LIMIT = 20;
export const JOB_LIST_MAX_LIMIT = 100;
/** Upper bound of rows read from D1 before filtering/paging. */
export const JOB_LIST_SCAN_CAP = 500;
export const JOB_LIST_PROMPT_PREVIEW_CHARS = 160;

const STATUSES: readonly JobStatus[] = ["active", "paused", "exhausted"];

export interface JobListQuery {
  status?: JobStatus;
  nameContains?: string;
  limit: number;
  offset: number;
  includePrompt: boolean;
}

export type JobListQueryResult = JobListQuery | { error: string };

export interface JobListItem {
  id: string;
  name: string;
  status: JobStatus;
  cadence_secs: number;
  thread_mode: JobRow["thread_mode"];
  session_id: string;
  run_count: number;
  max_runs: number | null;
  next_run_at: string;
  last_run_at: string | null;
  last_error: string | null;
  updated_at: string;
  prompt?: string;
  prompt_preview?: string;
}

export interface JobListView {
  /** Rows read for this owner (after the optional status filter in SQL). */
  scanned: number;
  /** True when `scanned` hit JOB_LIST_SCAN_CAP, so totals may be incomplete. */
  scanCapped: boolean;
  /** Rows matching every filter, before paging. */
  matched: number;
  offset: number;
  limit: number;
  returned: number;
  /** True when more matching rows exist past this page. */
  truncated: boolean;
  nextOffset: number | null;
  filters: { status: JobStatus | null; nameContains: string | null };
  coverage: string;
  jobs: JobListItem[];
}

function intInRange(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

export function parseJobListQuery(args: Record<string, unknown>): JobListQueryResult {
  const status = args.status;
  if (status !== undefined && status !== null && !(typeof status === "string" && (STATUSES as readonly string[]).includes(status))) {
    return { error: `status must be one of ${STATUSES.join(", ")}` };
  }
  const nameRaw = args.nameContains;
  if (nameRaw !== undefined && nameRaw !== null && typeof nameRaw !== "string") return { error: "nameContains must be a string" };
  const nameContains = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : undefined;
  const limit = intInRange(args.limit, JOB_LIST_DEFAULT_LIMIT, 1, JOB_LIST_MAX_LIMIT);
  if (limit === null) return { error: `limit must be an integer from 1 to ${JOB_LIST_MAX_LIMIT}` };
  const offset = intInRange(args.offset, 0, 0, JOB_LIST_SCAN_CAP);
  if (offset === null) return { error: `offset must be an integer from 0 to ${JOB_LIST_SCAN_CAP}` };
  const includePrompt = args.includePrompt === true;
  return { status: (status ?? undefined) as JobStatus | undefined, nameContains, limit, offset, includePrompt };
}

function preview(prompt: string): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > JOB_LIST_PROMPT_PREVIEW_CHARS ? `${chars.slice(0, JOB_LIST_PROMPT_PREVIEW_CHARS).join("")}…` : flat;
}

function toItem(row: JobRow, includePrompt: boolean): JobListItem {
  const item: JobListItem = {
    id: row.id,
    name: row.name,
    status: row.status,
    cadence_secs: row.cadence_secs,
    thread_mode: row.thread_mode,
    session_id: row.session_id,
    run_count: row.run_count,
    max_runs: row.max_runs,
    next_run_at: row.next_run_at,
    last_run_at: row.last_run_at,
    last_error: row.last_error,
    updated_at: row.updated_at,
  };
  if (includePrompt) item.prompt = row.prompt;
  else item.prompt_preview = preview(row.prompt);
  return item;
}

/**
 * Filter, page, and slim job rows. Rows are expected to already be owner-scoped
 * (and status-filtered when `query.status` is set); status is re-checked here
 * so the view stays correct if a caller passes unfiltered rows.
 */
export function buildJobListView(rows: readonly JobRow[], query: JobListQuery, scanCap = JOB_LIST_SCAN_CAP): JobListView {
  const needle = query.nameContains?.toLowerCase();
  const matching = rows.filter((row) =>
    (!query.status || row.status === query.status) && (!needle || row.name.toLowerCase().includes(needle)));
  const page = matching.slice(query.offset, query.offset + query.limit);
  const end = query.offset + page.length;
  const truncated = end < matching.length;
  const scanCapped = rows.length >= scanCap;
  const filterText = [query.status ? `status=${query.status}` : "", query.nameContains ? `name contains "${query.nameContains}"` : ""].filter(Boolean).join(", ");
  const coverage = `${page.length} of ${matching.length} matching job(s) returned${filterText ? ` (${filterText})` : ""}; ${rows.length} job(s) scanned${scanCapped ? ` — scan cap ${scanCap} reached, totals may be incomplete` : ""}${truncated ? `; more available at offset ${end}` : ""}.`;
  return {
    scanned: rows.length,
    scanCapped,
    matched: matching.length,
    offset: query.offset,
    limit: query.limit,
    returned: page.length,
    truncated,
    nextOffset: truncated ? end : null,
    filters: { status: query.status ?? null, nameContains: query.nameContains ?? null },
    coverage,
    jobs: page.map((row) => toItem(row, query.includePrompt)),
  };
}

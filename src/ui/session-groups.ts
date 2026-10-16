export type TimeGroup = "Today" | "Yesterday" | "Last 7 days" | "Older";

export const TIME_GROUPS: readonly TimeGroup[] = ["Today", "Yesterday", "Last 7 days", "Older"];

export type RunState = "working" | "idle" | "failed";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function timeGroupOf(updated: Date | null, now: Date): TimeGroup {
  if (!updated) return "Older";
  const today = startOfDay(now);
  const day = startOfDay(updated);
  if (day >= today) return "Today";
  if (day >= today - DAY_MS) return "Yesterday";
  if (day >= today - 6 * DAY_MS) return "Last 7 days";
  return "Older";
}

export function groupByTime<T>(rows: readonly T[], updatedOf: (row: T) => Date | null, now: Date): Array<{ group: TimeGroup; rows: T[] }> {
  const buckets = new Map<TimeGroup, T[]>(TIME_GROUPS.map((group) => [group, []]));
  for (const row of rows) buckets.get(timeGroupOf(updatedOf(row), now))!.push(row);
  return TIME_GROUPS.map((group) => ({ group, rows: buckets.get(group)! })).filter((bucket) => bucket.rows.length > 0);
}

export function matchesTitle(title: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || title.toLowerCase().includes(needle);
}

export function runStateOf(signal: "idle" | "running" | "reconnecting" | "error" | "offline"): RunState {
  if (signal === "running") return "working";
  if (signal === "error") return "failed";
  return "idle";
}

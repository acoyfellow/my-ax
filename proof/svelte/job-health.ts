// Pure health classification for recurring jobs (#7 job health surface).
//
// A transient gateway rate limit (3021 / 429 / overloaded) is not a real
// failure — after #6 the turn retries and the failure push is suppressed. But
// the Settings list still showed "failed · 3021: rate limiting…", which reads
// as a hard failure. This classifies a job's last outcome so the UI can show a
// benign "waiting out a rate limit" state distinctly from a genuine failure,
// making stuck loops visible without false alarms.
//
// Reuses the SAME isTransientRateLimit rule the server uses, so classification
// is consistent end to end.

import { isTransientRateLimit } from "../../src/upstream-rate-limit";

export type JobHealthState = "ok" | "waiting" | "paused" | "rate-limited" | "failed";
export type JobHealthTone = "ok" | "muted" | "warn" | "bad";

export type JobHealthInput = {
  status?: "active" | "paused" | string | null;
  last_error?: string | null;
  last_run_at?: string | null;
};

export type JobHealth = { state: JobHealthState; label: string; tone: JobHealthTone };

function shortError(err: string): string {
  const oneLine = err.replace(/\s+/g, " ").trim();
  return oneLine.length > 100 ? `${oneLine.slice(0, 97)}…` : oneLine;
}

export function classifyJobHealth(job: JobHealthInput): JobHealth {
  if (job.status === "paused") return { state: "paused", label: "paused", tone: "muted" };
  if (job.last_error) {
    if (isTransientRateLimit(job.last_error)) {
      return { state: "rate-limited", label: "waiting out a rate limit — will retry", tone: "warn" };
    }
    return { state: "failed", label: `failed · ${shortError(job.last_error)}`, tone: "bad" };
  }
  if (job.last_run_at) return { state: "ok", label: "ok", tone: "ok" };
  return { state: "waiting", label: "waiting", tone: "muted" };
}

/** data-job-result attribute value (kept stable for existing tests/selectors). */
export function jobResultAttr(health: JobHealth): "ok" | "error" | "rate-limited" {
  if (health.state === "failed") return "error";
  if (health.state === "rate-limited") return "rate-limited";
  return "ok";
}

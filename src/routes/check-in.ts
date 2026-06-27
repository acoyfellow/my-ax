import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { composeOwnerCheckIn, type CheckInSources } from "../check-in";

export async function readOwnerCheckIn(env: AppEnv["Bindings"], ownerEmail: string) {
  const owner = ownerEmail.toLowerCase();
  const [attention, jobs, runs, attentionTotal, activeJobsTotal, openRunsTotal, completedRunsTotal, failedRunsTotal] = await Promise.all([
    env.DB.prepare("SELECT id, title, body, href, created_at FROM attention_items WHERE owner_email = ? AND seen_at IS NULL ORDER BY created_at DESC LIMIT 10").bind(owner).all<CheckInSources["attention"][number]>(),
    env.DB.prepare("SELECT id, name, status, next_run_at, last_error FROM jobs WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 20").bind(owner).all<CheckInSources["jobs"][number]>(),
    env.DB.prepare("SELECT id, title, task_summary, status, updated_at FROM runs WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 20").bind(owner).all<CheckInSources["runs"][number]>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM attention_items WHERE owner_email = ? AND seen_at IS NULL").bind(owner).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM jobs WHERE owner_email = ? AND status = 'active'").bind(owner).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM runs WHERE owner_email = ? AND status IN ('open', 'running')").bind(owner).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM runs WHERE owner_email = ? AND status = 'completed'").bind(owner).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM runs WHERE owner_email = ? AND status = 'failed'").bind(owner).first<{ count: number }>(),
  ]);
  return composeOwnerCheckIn({
    attention: attention.results ?? [],
    jobs: jobs.results ?? [],
    runs: runs.results ?? [],
    totals: {
      attention: attentionTotal?.count ?? 0,
      activeJobs: activeJobsTotal?.count ?? 0,
      openRuns: openRunsTotal?.count ?? 0,
      completedRuns: completedRunsTotal?.count ?? 0,
      failedRuns: failedRunsTotal?.count ?? 0,
    },
  });
}

export function registerCheckInRoutes(app: Hono<AppEnv>) {
  app.get("/api/check-in", async (c) => c.json<ApiResponse>({
    ok: true,
    command: c.req.path,
    result: await readOwnerCheckIn(c.env, c.get("identity").email),
    next_actions: [],
  }));
}

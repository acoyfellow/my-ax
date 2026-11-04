import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { notifyOwner } from "./notify";
import { RIG_APPROVE, RIG_REJECT, runRigPipeline, type RigEffects, type RigPipelineParams, type RigStepOptions, type RigSteps } from "./rig-pipeline";
import type { Env } from "./types";

export const RIG_ACTOR = JSON.stringify({ id: "rig-pipeline", kind: "harness", mode: "live" });

export function rigPipelineEnabled(env: Pick<Env, "RIG_PIPELINE_ENABLED">): boolean {
  return env.RIG_PIPELINE_ENABLED === "1";
}

export function workflowSteps(step: WorkflowStep): RigSteps {
  return {
    run: <T extends Rpc.Serializable<T>>(name: string, options: RigStepOptions, work: () => Promise<T>) => step.do<T>(name, options, work),
    waitFor: async <T extends Rpc.Serializable<T>>(name: string, type: string, timeoutMs: number) => (await step.waitForEvent<T>(name, { type, timeout: timeoutMs })).payload,
  };
}

export async function recordRigEvent(env: Pick<Env, "DB">, params: RigPipelineParams, type: string, data: Record<string, unknown>): Promise<void> {
  const status = type === "rig.failed" ? "failed" : type === "rig.rejected" ? "aborted" : type === "rig.verified" || type === "rig.deployed" ? "completed" : "open";
  await env.DB.prepare("INSERT OR IGNORE INTO run_events(run_id, event_id, owner_email, ts, actor_json, type, data_json, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)")
    .bind(params.runId, `${type}:${crypto.randomUUID()}`, params.ownerEmail, new Date().toISOString(), RIG_ACTOR, type, JSON.stringify(data)).run();
  await env.DB.prepare("UPDATE runs SET status = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ?").bind(status, params.runId, params.ownerEmail).run();
}

export async function createRigDecision(env: Pick<Env, "DB">, params: RigPipelineParams, image: string): Promise<{ id: string; question: string; options: string[] }> {
  const id = `run-decision-${crypto.randomUUID()}`;
  const question = `Deploy ${params.commit.slice(0, 12)} to ${params.target}? Image ${image}`.slice(0, 200);
  const options = [RIG_APPROVE, RIG_REJECT];
  const bounds = { surface: "decision", question, options, sessionId: "", rigInstanceId: params.runId };
  await env.DB.prepare("INSERT INTO runs(id, owner_email, session_id, status, title, task_summary, bounds_json, created_at, updated_at) VALUES (?, ?, NULL, 'open', ?, ?, ?, datetime('now'), datetime('now'))")
    .bind(id, params.ownerEmail, "Rig deploy approval", question, JSON.stringify(bounds)).run();
  return { id, question, options };
}

async function githubBuildStatus(env: Env, commit: string): Promise<"success" | "pending" | "failure"> {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) throw new Error("GITHUB_TOKEN and GITHUB_REPO are required for the build step");
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/commits/${encodeURIComponent(commit)}/check-runs?per_page=100`, {
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "my-ax-rig" },
  });
  if (!response.ok) throw new Error(`GitHub check-runs returned ${response.status}`);
  const body = await response.json<{ check_runs: Array<{ status: string; conclusion: string | null }> }>();
  return summarizeChecks(body.check_runs);
}

export function summarizeChecks(runs: ReadonlyArray<{ status: string; conclusion: string | null }>): "success" | "pending" | "failure" {
  if (runs.length === 0 || runs.some((run) => run.status !== "completed")) return "pending";
  const passing = new Set(["success", "skipped", "neutral"]);
  return runs.every((run) => passing.has(run.conclusion ?? "")) ? "success" : "failure";
}

async function dispatchDeploy(env: Env, params: RigPipelineParams, image: string): Promise<{ ok: boolean; detail: string }> {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return { ok: false, detail: "GITHUB_TOKEN and GITHUB_REPO are required for the deploy step" };
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "my-ax-rig", "content-type": "application/json" },
    body: JSON.stringify({ event_type: "rig-deploy", client_payload: { run_id: params.runId, target: params.target, commit: params.commit, image } }),
  });
  if (response.status >= 500) throw new Error(`GitHub dispatch returned ${response.status}`);
  return response.status === 204 ? { ok: true, detail: "rig-deploy dispatched" } : { ok: false, detail: `GitHub dispatch returned ${response.status}` };
}

async function signedOutStatus(url: string): Promise<{ signedOutStatus: number }> {
  const response = await fetch(url, { redirect: "manual" });
  return { signedOutStatus: response.status };
}

export function liveRigEffects(env: Env): RigEffects {
  return {
    buildStatus: (commit) => githubBuildStatus(env, commit),
    askApproval: async (params, image) => {
      const decision = await createRigDecision(env, params, image);
      await notifyOwner(env, params.ownerEmail, {
        kind: "deploy.gate",
        stableName: "Rig pipeline",
        title: `Deploy to ${params.target}?`,
        body: decision.question,
        href: `/api/decisions/${decision.id}`,
        decision: { id: decision.id, options: decision.options },
        dedupeKey: `rig-approval:${params.runId}`,
      });
      return { decisionId: decision.id };
    },
    deploy: (params, image) => dispatchDeploy(env, params, image),
    verify: signedOutStatus,
    record: (params, type, data) => recordRigEvent(env, params, type, data),
  };
}

export class RigPipeline extends WorkflowEntrypoint<Env, RigPipelineParams> {
  override async run(event: Readonly<WorkflowEvent<RigPipelineParams>>, step: WorkflowStep) {
    return runRigPipeline(event.payload, workflowSteps(step), liveRigEffects(this.env));
  }
}

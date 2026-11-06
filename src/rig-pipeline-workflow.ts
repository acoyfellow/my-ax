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

export type DeployTrigger = { url: string; body: URLSearchParams } | { error: string };

export function gitlabPreviewTrigger(config: { url?: string; token?: string }, params: RigPipelineParams, image: string): DeployTrigger {
  if (!config.url || !config.token) return { error: "RIG_DEPLOY_TRIGGER_URL and RIG_DEPLOY_TRIGGER_TOKEN are required for the deploy step" };
  const pr = /^pr-([0-9]+)$/.exec(params.target)?.[1];
  if (!pr) return { error: `target ${params.target} is not a preview; production deploys stay manual in GitLab` };
  const body = new URLSearchParams({ token: config.token, ref: "main" });
  body.set("variables[DEPLOY_TARGET]", "preview");
  body.set("variables[PR]", pr);
  body.set("variables[PREVIEW_COMPUTER_IMAGE]", image);
  body.set("variables[RIG_RUN_ID]", params.runId);
  return { url: config.url, body };
}

async function triggerDeploy(env: Env, params: RigPipelineParams, image: string): Promise<{ ok: boolean; detail: string }> {
  const trigger = gitlabPreviewTrigger({ url: env.RIG_DEPLOY_TRIGGER_URL, token: env.RIG_DEPLOY_TRIGGER_TOKEN }, params, image);
  if ("error" in trigger) return { ok: false, detail: trigger.error };
  const response = await fetch(trigger.url, { method: "POST", body: trigger.body });
  if (response.status >= 500) throw new Error(`deploy trigger returned ${response.status}`);
  if (response.status !== 201) return { ok: false, detail: `deploy trigger returned ${response.status}` };
  const pipeline = await response.json<{ id?: number; web_url?: string }>().catch(() => ({} as { id?: number; web_url?: string }));
  return { ok: true, detail: `pipeline ${pipeline.id ?? "unknown"} ${pipeline.web_url ?? ""}`.trim() };
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
    deploy: (params, image) => triggerDeploy(env, params, image),
    verify: signedOutStatus,
    record: (params, type, data) => recordRigEvent(env, params, type, data),
  };
}

export class RigPipeline extends WorkflowEntrypoint<Env, RigPipelineParams> {
  override async run(event: Readonly<WorkflowEvent<RigPipelineParams>>, step: WorkflowStep) {
    return runRigPipeline(event.payload, workflowSteps(step), liveRigEffects(this.env));
  }
}

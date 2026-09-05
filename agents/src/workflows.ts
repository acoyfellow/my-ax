import { Effect } from "effect";
import {
  DEFAULT_AGENTS_MODEL,
  type IssueInput,
  type PullInput,
  requireGateway,
  resolveAgentsModel,
} from "./policy";
import { type GithubPort, type TerrariumPort } from "./orchestrate";
import { auditGithubLayer, runAuditEffect } from "./audit-effect";
import { runTriageEffect, triageLayer } from "./triage-effect";

export interface AgentsEnv {
  AGENTS_MODEL?: string;
  LLM_GATEWAY_URL?: string;
  LLM_GATEWAY_TOKEN?: string;
  TERRARIUM_URL?: string;
  TERRARIUM_CONTROL_TOKEN?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  HOOK_FORWARD_SECRET?: string;
}

export function forwardedFromHook(request: Request, env: { HOOK_FORWARD_SECRET?: string }): boolean {
  const expected = env.HOOK_FORWARD_SECRET?.trim();
  const got = request.headers.get("x-ax-hook-forward") || "";
  return Boolean(expected) && expected === got;
}

export const WORKFLOW_NAMES = ["TriageWorkflow", "AuditWorkflow", "DigWorkflow", "ReviewWorkflow"] as const;

export function workflowBindings(): typeof WORKFLOW_NAMES {
  return WORKFLOW_NAMES;
}

export function executeTriageWorkflow(
  env: AgentsEnv,
  input: IssueInput,
  ports: { github: GithubPort; terrarium: TerrariumPort },
) {
  return Effect.sync(() => {
    requireGateway(env);
    return resolveAgentsModel(env);
  }).pipe(
    Effect.flatMap((modelId) => runTriageEffect(input).pipe(Effect.provide(triageLayer({ ...ports, model: { modelId } })))),
  );
}

export function executeAuditWorkflow(
  env: AgentsEnv,
  input: PullInput,
  ports: { github: GithubPort; promptDigest: string },
) {
  return Effect.sync(() => {
    requireGateway(env);
    resolveAgentsModel(env);
  }).pipe(
    Effect.flatMap(() => runAuditEffect(input, ports.promptDigest).pipe(Effect.provide(auditGithubLayer(ports.github)))),
  );
}

export function executeDigWorkflow(
  env: AgentsEnv,
  input: IssueInput,
  ports: { github: GithubPort; terrarium: TerrariumPort },
) {
  return executeTriageWorkflow(env, { ...input, body: `${input.body}\n\nneeds a cell / terrarium` }, ports);
}

export function defaultModelId(): string {
  return DEFAULT_AGENTS_MODEL;
}

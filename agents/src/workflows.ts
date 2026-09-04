import {
  DEFAULT_AGENTS_MODEL,
  type IssueInput,
  type PullInput,
  requireGateway,
  resolveAgentsModel,
} from "./policy";
import { runAudit, runTriage, type GithubPort, type TerrariumPort } from "./orchestrate";
import { runReview } from "./review";
import { createImplementationModel } from "./model-implementation";

export interface AgentsEnv {
  AGENTS_MODEL?: string;
  LLM_GATEWAY_URL?: string;
  LLM_GATEWAY_TOKEN?: string;
  LLM_GATEWAY_AUTH_HEADER?: string;
  TERRARIUM_URL?: string;
  TERRARIUM_CONTROL_TOKEN?: string;
  FACTORY_SUBMISSION_URL?: string;
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

export async function executeTriageWorkflow(
  env: AgentsEnv,
  input: IssueInput,
  ports: { github: GithubPort; terrarium: TerrariumPort },
) {
  requireGateway(env);
  const modelId = resolveAgentsModel(env);
  return runTriage(input, { ...ports, model: createImplementationModel(env, modelId) });
}

export async function executeAuditWorkflow(
  env: AgentsEnv,
  input: PullInput,
  ports: { github: GithubPort; promptDigest: string },
) {
  requireGateway(env);
  resolveAgentsModel(env);
  return runAudit(input, ports);
}

export async function executeReviewWorkflow(
  env: AgentsEnv,
  input: PullInput & { head?: string; proofExit?: number; proofLog?: string },
  ports: { github: GithubPort },
) {
  requireGateway(env);
  return runReview(input, ports);
}

export async function executeDigWorkflow(
  env: AgentsEnv,
  input: IssueInput,
  ports: { github: GithubPort; terrarium: TerrariumPort },
) {
  requireGateway(env);
  return executeTriageWorkflow(env, { ...input, body: `${input.body}\n\nneeds a cell / terrarium` }, ports);
}

export function defaultModelId(): string {
  return DEFAULT_AGENTS_MODEL;
}

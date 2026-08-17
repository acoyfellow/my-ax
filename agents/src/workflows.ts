import {
  DEFAULT_AGENTS_MODEL,
  type IssueInput,
  type PullInput,
  requireGateway,
  resolveAgentsModel,
} from "./policy";
import { runAudit, runTriage, type GithubPort, type TerrariumPort } from "./orchestrate";

export interface AgentsEnv {
  AGENTS_MODEL?: string;
  LLM_GATEWAY_URL?: string;
  LLM_GATEWAY_TOKEN?: string;
  TERRARIUM_URL?: string;
  TERRARIUM_CONTROL_TOKEN?: string;
  GITHUB_WEBHOOK_SECRET?: string;
}

export const WORKFLOW_NAMES = ["TriageWorkflow", "AuditWorkflow", "DigWorkflow"] as const;

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
  return runTriage(input, { ...ports, model: { modelId } });
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

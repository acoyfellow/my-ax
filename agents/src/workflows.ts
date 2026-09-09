import { Data, Effect } from "effect";
import {
  DEFAULT_AGENTS_MODEL,
  type IssueInput,
  type PullInput,
  requireGateway,
  resolveAgentsModel,
} from "./policy";
import { type GithubPort, type TerrariumPort } from "./orchestrate";
import { createImplementationModel } from "./model-implementation";
import { auditGithubLayer, runAuditEffect } from "./audit-effect";
import { runTriageEffect, triageLayer } from "./triage-effect";

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

export class WorkflowConfigurationError extends Data.TaggedError("WorkflowConfigurationError")<{ cause: unknown }> {
  get message() { return "LLM_GATEWAY configuration is required before running a workflow"; }
}

function configuredModel(env: AgentsEnv) {
  return Effect.try({
    try: () => { requireGateway(env); return resolveAgentsModel(env); },
    catch: (cause) => new WorkflowConfigurationError({ cause }),
  });
}

export function executeTriageWorkflow(
  env: AgentsEnv,
  input: IssueInput,
  ports: { github: GithubPort; terrarium: TerrariumPort },
) {
  return configuredModel(env).pipe(
    Effect.flatMap((modelId) => runTriageEffect(input).pipe(Effect.provide(triageLayer({ ...ports, model: createImplementationModel(env, modelId) })))),
  );
}

export function executeAuditWorkflow(
  env: AgentsEnv,
  input: PullInput,
  ports: { github: GithubPort; promptDigest: string },
) {
  return configuredModel(env).pipe(
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

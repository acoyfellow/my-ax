// Curated model catalog. The UI intentionally shows only the current usable
// set; provider plumbing is an implementation detail and never appears in the
// label. Availability is enforced by Workers AI or the configured gateway at
// call time — operators control which gateway model ids their users may access.

import type { Env } from "./types";

export type ModelRoute = "workers-ai" | "gateway-openai" | "gateway-anthropic";

export interface ModelEntry {
  id: string;
  route: ModelRoute;
  owned_by: string;
  context: number;
  reasoning: boolean;
  tools: boolean;
  vision: boolean;
  label: string;
}

export const MODELS: ModelEntry[] = [
  {
    id: "@cf/moonshotai/kimi-k2.7-code",
    route: "workers-ai",
    owned_by: "moonshotai",
    context: 262_144,
    reasoning: true,
    tools: true,
    vision: true,
    label: "Kimi K2.7 Code",
  },
  {
    id: "@cf/zai-org/glm-5.2",
    route: "workers-ai",
    owned_by: "zai",
    context: 262_144,
    reasoning: true,
    tools: true,
    vision: false,
    label: "GLM 5.2",
  },
  {
    id: "claude-opus-4-8",
    route: "gateway-anthropic",
    owned_by: "anthropic",
    context: 1_000_000,
    reasoning: true,
    tools: true,
    vision: true,
    label: "Opus 4.8",
  },
  {
    id: "gpt-5.5",
    route: "gateway-openai",
    owned_by: "openai",
    context: 400_000,
    reasoning: true,
    tools: true,
    vision: true,
    label: "GPT-5.5",
  },
  {
    id: "gpt-5.6-luna",
    route: "gateway-openai",
    owned_by: "openai",
    context: 400_000,
    reasoning: true,
    tools: true,
    vision: true,
    label: "GPT-5.6 Luna",
  },
  {
    id: "gpt-5.6-sol",
    route: "gateway-openai",
    owned_by: "openai",
    context: 400_000,
    reasoning: true,
    tools: true,
    vision: true,
    label: "GPT-5.6 Sol",
  },
  {
    id: "gpt-5.6-terra",
    route: "gateway-openai",
    owned_by: "openai",
    context: 400_000,
    reasoning: true,
    tools: true,
    vision: true,
    label: "GPT-5.6 Terra",
  },
];

// Gateway-less fallback default (public/OSS installs with no LLM gateway). The
// only routes such a build can run are the Workers-AI rows, so the constant
// default must stay a Workers-AI model or resolveAvailableModelId can never heal
// a pinned/absent model to something runnable.
export const DEFAULT_MODEL_ID = "@cf/moonshotai/kimi-k2.7-code";

// Preferred default when the deployment HAS the LLM gateway (the employee/prod
// path). Routed through the AI gateway, so it inherits the transient 3021/429
// retry-with-backoff wrapper (see llm.ts createRetryFetch) that the raw
// Workers-AI binding path lacks — the Workers-AI default was failing ~half its
// turns on gateway rate limits with no self-healing. gpt-5.6-terra is the
// low-cost/fast gateway model.
export const DEFAULT_GATEWAY_MODEL_ID = "gpt-5.6-terra";

export function hasModelGateway(env: Env): boolean {
  return Boolean(env.LLM_GATEWAY_URL?.trim() && env.LLM_GATEWAY_TOKEN?.trim());
}

// Keep the catalog honest per installation. Workers AI rows are available in
// the public engine; gateway rows are visible only when the deployment supplied
// the private gateway URL and token needed to run them.
export function availableModels(env: Env): ModelEntry[] {
  return hasModelGateway(env) ? MODELS : MODELS.filter((model) => model.route === "workers-ai");
}

// The effective default for THIS installation: the gateway model when the
// gateway is configured (and the model is actually in the available catalog),
// otherwise the Workers-AI fallback. Callers that mint the initial/healed model
// id must use this, not the bare DEFAULT_MODEL_ID constant, so a gateway deploy
// starts on the resilient gateway route instead of the brittle Workers-AI one.
export function defaultModelId(env: Env): string {
  if (hasModelGateway(env) && availableModels(env).some((model) => model.id === DEFAULT_GATEWAY_MODEL_ID)) {
    return DEFAULT_GATEWAY_MODEL_ID;
  }
  return DEFAULT_MODEL_ID;
}

export function findModel(id: string): ModelEntry | undefined {
  return MODELS.find((model) => model.id === id);
}

/** Resolve a requested model id to a usable catalog entry. A stale or removed
 * id (e.g. a churned alpha model still pinned in a session/Settings) heals to
 * the default instead of hard-failing every turn with model_not_found. */
export function resolveModelId(id: string | undefined): string {
  return id && findModel(id) ? id : DEFAULT_MODEL_ID;
}

/** Resolve a model id against the models this installation can actually run.
 * A session pinned to a gateway model must heal when the gateway is absent,
 * otherwise every turn fails with a provider configuration error even though
 * the visible catalog correctly hides that model. */
export function resolveAvailableModelId(env: Env, id: string | undefined): string {
  const requested = id && findModel(id);
  if (!requested) return defaultModelId(env);
  return availableModels(env).some((model) => model.id === requested.id) ? requested.id : defaultModelId(env);
}

// Curated model catalog. The UI intentionally shows only the current frontier
// set; provider plumbing is an implementation detail and never appears in the
// label. Availability is enforced by the configured gateway/account at call
// time — operators control which of these model ids their users may access.

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
    id: "kindle-alpha-api",
    route: "gateway-openai",
    owned_by: "custom",
    context: 1_000_000,
    reasoning: true,
    tools: true,
    vision: true,
    label: "Kindle Alpha API",
  },
  {
    id: "mercury-alpha",
    route: "gateway-openai",
    owned_by: "custom",
    context: 1_000_000,
    reasoning: true,
    tools: true,
    vision: true,
    label: "Mercury Alpha",
  },
];

export const DEFAULT_MODEL_ID = "@cf/moonshotai/kimi-k2.7-code";

// Keep the catalog stable and provider-agnostic. The configured gateway is the
// policy boundary: if an operator has not granted a model, that turn fails with
// the upstream authorization/model error instead of hiding different UI rows.
export function availableModels(_env: Env): ModelEntry[] {
  return MODELS;
}

export function defaultModelId(_env: Env): string {
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

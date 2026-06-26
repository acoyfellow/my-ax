// Curated model catalog. Keep this list boring: every row shown in Settings
// should be a real model route the current public engine can attempt without a
// private gateway. Stale ids from older sessions heal to the default.

import type { Env } from "./types";

export type ModelRoute = "workers-ai";

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
    id: "@cf/meta/llama-4-scout-17b-16e-instruct",
    route: "workers-ai",
    owned_by: "meta",
    context: 131_072,
    reasoning: false,
    tools: true,
    vision: true,
    label: "Llama 4 Scout",
  },
  {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    route: "workers-ai",
    owned_by: "meta",
    context: 24_000,
    reasoning: false,
    tools: true,
    vision: false,
    label: "Llama 3.3 70B Fast",
  },
  {
    id: "@cf/meta/llama-3.1-8b-instruct-fast",
    route: "workers-ai",
    owned_by: "meta",
    context: 8_192,
    reasoning: false,
    tools: true,
    vision: false,
    label: "Llama 3.1 8B Fast",
  },
  {
    id: "@cf/qwen/qwq-32b",
    route: "workers-ai",
    owned_by: "qwen",
    context: 32_768,
    reasoning: true,
    tools: true,
    vision: false,
    label: "QwQ 32B",
  },
  {
    id: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    route: "workers-ai",
    owned_by: "mistralai",
    context: 32_768,
    reasoning: false,
    tools: true,
    vision: true,
    label: "Mistral Small 3.1",
  },
];

export const DEFAULT_MODEL_ID = "@cf/meta/llama-4-scout-17b-16e-instruct";

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
 * id heals to the default instead of hard-failing every turn with model_not_found. */
export function resolveModelId(id: string | undefined): string {
  return id && findModel(id) ? id : DEFAULT_MODEL_ID;
}

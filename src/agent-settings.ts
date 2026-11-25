import { sanitizeLayerIds } from "./model-layers";
import { resolvePiModelChoice } from "./pi-engine/gateway-models";
import { sanitizeThinkingLevel, type ThinkingLevel } from "./pi-engine/thinking-level";

import { MAX_AGENT_INSTRUCTIONS_LENGTH } from "./agent-settings-limits";

export { MAX_AGENT_INSTRUCTIONS_LENGTH };

export type AgentSettings = {
  model: string | null;
  reasoning: ThinkingLevel | null;
  layers: string[] | null;
  instructions: string | null;
  showMetrics: boolean;
};

export type GlobalSettings = {
  model?: string;
  reasoning?: string;
  layers?: unknown;
};

export type EffectiveSettings = {
  model: string | undefined;
  reasoning: ThinkingLevel | undefined;
  layers: string[];
  hasOverrides: boolean;
};

export function defaultAgentSettings(): AgentSettings {
  return { model: null, reasoning: null, layers: null, instructions: null, showMetrics: false };
}

function sanitizeModel(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  return resolvePiModelChoice(raw) ? raw : null;
}

function sanitizeInstructions(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_AGENT_INSTRUCTIONS_LENGTH) return null;
  return trimmed;
}

export function sanitizeAgentSettings(raw: unknown): AgentSettings {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    model: sanitizeModel(source.model),
    reasoning: sanitizeThinkingLevel(source.reasoning) ?? null,
    layers: Array.isArray(source.layers) ? sanitizeLayerIds(source.layers) : null,
    instructions: sanitizeInstructions(source.instructions),
    showMetrics: source.showMetrics === true,
  };
}

export function hasAgentOverrides(settings: AgentSettings): boolean {
  return settings.model !== null || settings.reasoning !== null || settings.layers !== null || settings.instructions !== null || settings.showMetrics;
}

export function resolveEffectiveSettings(agent: AgentSettings, global: GlobalSettings): EffectiveSettings {
  return {
    model: agent.model ?? (global.model || undefined),
    reasoning: agent.reasoning ?? sanitizeThinkingLevel(global.reasoning),
    layers: agent.layers ?? sanitizeLayerIds(global.layers),
    hasOverrides: hasAgentOverrides(agent),
  };
}

export function combineInstructions(ownerInstructions: string, agent: AgentSettings): string {
  if (!agent.instructions) return ownerInstructions;
  return `${ownerInstructions}\n\nAgent-specific instructions:\n${agent.instructions}`;
}

import type { CompactionSettings } from "@earendil-works/pi-durable";

export const LARGE_WINDOW_COMPACT_AT_TOKENS = 150_000;
export const LARGE_WINDOW_KEEP_RECENT_TOKENS = 30_000;
export const SUMMARY_MAX_TOKENS = 8_000;
export const BACKGROUND_LEAD_TOKENS = 30_000;

export type WindowedModel = { provider: string; id: string; contextWindow: number };

export function largeWindowOverride(contextWindow: number) {
  const reserveTokens = Math.max(contextWindow - LARGE_WINDOW_COMPACT_AT_TOKENS, Math.ceil(SUMMARY_MAX_TOKENS / 0.8));
  return { reserveTokens, keepRecentTokens: LARGE_WINDOW_KEEP_RECENT_TOKENS, backgroundTokens: BACKGROUND_LEAD_TOKENS };
}

export function piCompactionSettings(models: readonly WindowedModel[]): CompactionSettings {
  const modelOverrides: Record<string, ReturnType<typeof largeWindowOverride>> = {};
  for (const model of models) if (model.contextWindow > LARGE_WINDOW_COMPACT_AT_TOKENS * 2) modelOverrides[`${model.provider}/${model.id}`] = largeWindowOverride(model.contextWindow);
  return { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000, backgroundTokens: 32_768, modelOverrides };
}

export function compactsAt(contextWindow: number): number {
  return contextWindow - largeWindowOverride(contextWindow).reserveTokens;
}

export function summaryBudget(contextWindow: number): number {
  return Math.floor(0.8 * largeWindowOverride(contextWindow).reserveTokens);
}

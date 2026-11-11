export type CycleCostUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  basis: "ai_sdk_total_usage" | "ai_sdk_step_usage" | "unavailable";
};

export type CycleCostInput = {
  ownerEmail: string;
  sessionOrRunId: string;
  cycleIndex: number;
  ts?: string;
  model?: string | null;
  finishReason?: string | null;
  usage: CycleCostUsage;
  recipesUsed?: unknown[];
  recipesSaved?: unknown[];
};

export type CycleCostRow = {
  id: string;
  owner_email: string;
  session_or_run_id: string;
  cycle_index: number;
  ts: string;
  model: string | null;
  finish_reason: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  usage_basis: string;
  recipes_used_json: string;
  recipes_saved_json: string;
};

export type CycleCostPoint = {
  id: string;
  sessionOrRunId: string;
  cycleIndex: number;
  ts: string;
  model: string | null;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  usageBasis: string;
  recipesUsed: unknown[];
  recipesSaved: unknown[];
};

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function cycleCostPoint(row: CycleCostRow): CycleCostPoint {
  return {
    id: row.id,
    sessionOrRunId: row.session_or_run_id,
    cycleIndex: row.cycle_index,
    ts: row.ts,
    model: row.model,
    finishReason: row.finish_reason,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    usageBasis: row.usage_basis,
    recipesUsed: parseJsonArray(row.recipes_used_json),
    recipesSaved: parseJsonArray(row.recipes_saved_json),
  };
}

export const COST_SUMMARY_WINDOW_DAYS = 7;

export type CostSummaryWindow = { todayStart: string; weekStart: string; now: string };

export function costSummaryWindow(nowMillis: number): CostSummaryWindow {
  const now = new Date(nowMillis);
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekStart = new Date(nowMillis - COST_SUMMARY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { todayStart: todayStart.toISOString(), weekStart: weekStart.toISOString(), now: now.toISOString() };
}

export type CostSummaryTotalsRow = {
  today_tokens: number | null;
  week_tokens: number | null;
  cycles: number;
  sessions: number;
};

export type CostSummaryModelRow = {
  model: string | null;
  tokens: number | null;
  cycles: number;
};

export type CostSummaryModel = { model: string | null; label: string; tokens: number; cycles: number };

export type CostSummary = {
  windowDays: number;
  todayStart: string;
  weekStart: string;
  todayTokens: number;
  weekTokens: number;
  cycles: number;
  sessions: number;
  models: CostSummaryModel[];
};

export function costSummary(
  window: CostSummaryWindow,
  totals: CostSummaryTotalsRow | null,
  models: readonly CostSummaryModelRow[],
  labelFor: (model: string) => string | undefined,
): CostSummary {
  return {
    windowDays: COST_SUMMARY_WINDOW_DAYS,
    todayStart: window.todayStart,
    weekStart: window.weekStart,
    todayTokens: totals?.today_tokens ?? 0,
    weekTokens: totals?.week_tokens ?? 0,
    cycles: totals?.cycles ?? 0,
    sessions: totals?.sessions ?? 0,
    models: models.map((row) => ({
      model: row.model,
      label: row.model ? labelFor(row.model) ?? row.model : "Unknown model",
      tokens: row.tokens ?? 0,
      cycles: row.cycles,
    })),
  };
}

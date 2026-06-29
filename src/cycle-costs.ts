import type { Env } from "./types";

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

function owner(ownerEmail: string): string {
  return ownerEmail.toLowerCase();
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function nextCycleIndex(env: Env, ownerEmail: string, sessionOrRunId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COALESCE(MAX(cycle_index), -1) + 1 AS next FROM cycle_costs WHERE owner_email = ? AND session_or_run_id = ?")
    .bind(owner(ownerEmail), sessionOrRunId)
    .first<{ next: number }>();
  return row?.next ?? 0;
}

export async function recordCycleCost(env: Env, input: CycleCostInput): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO cycle_costs (id, owner_email, session_or_run_id, cycle_index, ts, model, finish_reason, input_tokens, output_tokens, total_tokens, usage_basis, recipes_used_json, recipes_saved_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id,
      owner(input.ownerEmail),
      input.sessionOrRunId,
      input.cycleIndex,
      input.ts ?? new Date().toISOString(),
      input.model ?? null,
      input.finishReason ?? null,
      input.usage.inputTokens,
      input.usage.outputTokens,
      input.usage.totalTokens,
      input.usage.basis,
      JSON.stringify(input.recipesUsed ?? []),
      JSON.stringify(input.recipesSaved ?? []),
    ).run();
  return { id };
}

export async function readCycleCostSeries(env: Env, ownerEmail: string, sessionOrRunId: string): Promise<CycleCostPoint[]> {
  const { results = [] } = await env.DB.prepare("SELECT * FROM cycle_costs WHERE owner_email = ? AND session_or_run_id = ? ORDER BY cycle_index ASC, ts ASC")
    .bind(owner(ownerEmail), sessionOrRunId)
    .all<CycleCostRow>();
  return results.map((row) => ({
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
  }));
}

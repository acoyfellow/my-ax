export type TokenUsageModel = { model: string | null; label: string; tokens: number; cycles: number };

export type TokenUsageSummary = {
  windowDays: number;
  todayTokens: number;
  weekTokens: number;
  cycles: number;
  sessions: number;
  models: TokenUsageModel[];
};

export type TokenUsageState =
  | { kind: "loading" }
  | { kind: "ready"; summary: TokenUsageSummary }
  | { kind: "error"; message: string };

const tokenFormat = new Intl.NumberFormat("en-US");

export function formatTokens(tokens: number): string {
  return tokenFormat.format(Math.max(0, Math.round(tokens)));
}

export function countLabel(count: number, singular: string, plural: string): string {
  return `${formatTokens(count)} ${count === 1 ? singular : plural}`;
}

export async function loadTokenUsage(fetcher: typeof fetch): Promise<TokenUsageState> {
  try {
    const response = await fetcher("/api/cost-summary", { credentials: "include", cache: "no-store" });
    const body = await response.json().catch(() => null) as { ok?: boolean; result?: TokenUsageSummary } | null;
    if (!response.ok || !body?.ok || !body.result) return { kind: "error", message: `Token usage is not available (HTTP ${response.status}).` };
    return { kind: "ready", summary: body.result };
  } catch {
    return { kind: "error", message: "Token usage is not available (network error)." };
  }
}

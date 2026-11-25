export type SeismoKind = "mac" | "box" | "web" | "llm" | "err" | "wait";

export interface SeismoBar {
  v: number;
  k: SeismoKind;
  l?: string;
  d?: number;
  t?: number;
  o?: number;
}

export interface SeismoPulse {
  bars: SeismoBar[];
  blocked: boolean;
}

export interface SpanSample {
  chat_id: string;
  tool_name?: string | null;
  phase?: string | null;
  status?: string | null;
  error?: string | null;
  started_ms: number;
  dur_ms?: number | null;
  output_tokens?: number | null;
}

const MAC_PREFIXES = ["machinectl", "cmux_"];
const WEB_EXACT = new Set(["web_search", "browser_open", "fetch_url"]);

export function classifySpanKind(span: Pick<SpanSample, "tool_name" | "status" | "error">): SeismoKind {
  if (span.error || (span.status && span.status !== "ok" && span.status !== "success")) {
    return "err";
  }
  const tool = (span.tool_name ?? "").trim();
  if (!tool) return "llm";
  if (tool === "ask_user") return "wait";
  if (MAC_PREFIXES.some((p) => tool.startsWith(p))) return "mac";
  if (WEB_EXACT.has(tool) || tool.startsWith("mcp__")) return "web";
  return "box";
}

export function normalizeSpanHeight(span: Pick<SpanSample, "dur_ms" | "output_tokens">): number {
  const dur = Math.max(0, Number(span.dur_ms ?? 0));
  const tokens = Math.max(0, Number(span.output_tokens ?? 0));
  // Combine log-scaled duration (ms) and output token burst so both quick
  // tool calls and long reasoning steps remain visually legible.
  const durScore = dur > 0 ? Math.log10(dur + 10) * 22 : 0;
  const tokScore = tokens > 0 ? Math.log10(tokens + 10) * 24 : 0;
  const raw = Math.max(durScore, tokScore);
  return Math.max(12, Math.min(100, Math.round(raw)));
}

/**
 * Group recent pi_spans rows by chat_id into fixed-cap left-to-right
 * (oldest -> newest) seismograph pulses.
 */
export function buildSeismographMap(
  rows: SpanSample[],
  maxBars = 16,
): Map<string, SeismoPulse> {
  const grouped = new Map<string, SpanSample[]>();
  for (const row of rows) {
    if (!row?.chat_id) continue;
    let list = grouped.get(row.chat_id);
    if (!list) {
      list = [];
      grouped.set(row.chat_id, list);
    }
    list.push(row);
  }

  const out = new Map<string, SeismoPulse>();
  for (const [chatId, list] of grouped) {
    list.sort((a, b) => a.started_ms - b.started_ms);
    const tail = list.slice(-maxBars);
    const bars: SeismoBar[] = tail.map((s) => {
      const k = classifySpanKind(s);
      const tool = (s.tool_name ?? "").trim();
      const l = tool || (k === "llm" ? "model" : k);
      const d = typeof s.dur_ms === "number" && s.dur_ms > 0 ? Math.round(s.dur_ms) : undefined;
      const t = typeof s.started_ms === "number" && s.started_ms > 0 ? Math.round(s.started_ms) : undefined;
      const o = typeof s.output_tokens === "number" && s.output_tokens > 0 ? Math.round(s.output_tokens) : undefined;
      return {
        v: normalizeSpanHeight(s),
        k,
        l,
        ...(d !== undefined ? { d } : {}),
        ...(t !== undefined ? { t } : {}),
        ...(o !== undefined ? { o } : {}),
      };
    });
    const last = bars[bars.length - 1];
    const blocked = last ? last.k === "wait" || last.k === "err" : false;
    out.set(chatId, { bars, blocked });
  }
  return out;
}

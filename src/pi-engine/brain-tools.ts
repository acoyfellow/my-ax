import { num, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { awaitWithContext } from "@earendil-works/chord/context";
import { clipToolOutput } from "./workspace-tools";

export const BRAIN_QUESTIONS = ["slowest_steps", "tool_usage", "model_cost", "errors", "chat_timeline"] as const;
export type BrainQuestion = (typeof BRAIN_QUESTIONS)[number];

export type BrainArgs = { question: BrainQuestion; hours?: number; chat?: string; tool?: string; limit?: number };

export type BrainConfig = { accountId: string; token: string; service: string; fetch?: typeof fetch };

type Filter = { key: string; operation: string; type: "string" | "number"; value: string | number };
type Calculation = { operator: string; key?: string; keyType?: "number"; alias: string };

const MAX_HOURS = 24 * 7;
const MAX_LIMIT = 50;

function span(filters: Filter[], service: string): Filter[] {
  return [{ key: "$metadata.service", operation: "eq", type: "string", value: service }, { key: "ev", operation: "eq", type: "string", value: "pi.span" }, ...filters];
}

function scoped(args: BrainArgs): Filter[] {
  const filters: Filter[] = [];
  if (args.chat) filters.push({ key: "chat", operation: "eq", type: "string", value: args.chat });
  if (args.tool) filters.push({ key: "attrs.tool.name", operation: "eq", type: "string", value: args.tool });
  return filters;
}

const duration: Calculation[] = [
  { operator: "count", alias: "count" },
  { operator: "median", key: "durMs", keyType: "number", alias: "median_ms" },
  { operator: "p99", key: "durMs", keyType: "number", alias: "p99_ms" },
  { operator: "sum", key: "durMs", keyType: "number", alias: "total_ms" },
];

export function brainQuery(args: BrainArgs, service: string, now: number): Record<string, unknown> {
  const hours = Math.min(Math.max(args.hours ?? 24, 1), MAX_HOURS);
  const limit = Math.min(Math.max(args.limit ?? 15, 1), MAX_LIMIT);
  const timeframe = { from: now - hours * 3_600_000, to: now };
  const base = { queryId: `brain-${args.question}`, timeframe };
  const extra = scoped(args);
  const calculations = (filters: Filter[], calcs: Calculation[], groupBy: string[]) => ({
    ...base,
    view: "calculations",
    parameters: { datasets: ["cloudflare-workers"], filters: span(filters, service), calculations: calcs, groupBys: groupBy.map((value) => ({ type: "string", value })), orderBy: { value: calcs[0].alias, order: "desc" }, limit },
  });
  switch (args.question) {
    case "slowest_steps":
      return calculations(extra, [{ operator: "p99", key: "durMs", keyType: "number", alias: "p99_ms" }, ...duration.filter((calc) => calc.alias !== "p99_ms")], ["name", "attrs.phase", "attrs.tool.name"]);
    case "tool_usage":
      return calculations([...extra, { key: "attrs.task.name", operation: "eq", type: "string", value: "pi.tool" }], duration, ["attrs.tool.name", "status"]);
    case "model_cost":
      return calculations([...extra, { key: "name", operation: "eq", type: "string", value: "pi.ai.request" }], [
        { operator: "sum", key: "attrs.cost.total", keyType: "number", alias: "cost_usd" },
        { operator: "count", alias: "requests" },
        { operator: "sum", key: "attrs.usage.input", keyType: "number", alias: "input_tokens" },
        { operator: "sum", key: "attrs.usage.cache_read", keyType: "number", alias: "cache_read_tokens" },
        { operator: "sum", key: "attrs.usage.output", keyType: "number", alias: "output_tokens" },
        { operator: "median", key: "durMs", keyType: "number", alias: "median_ms" },
      ], ["attrs.model", "chat"]);
    case "errors":
      return calculations([...extra, { key: "status", operation: "eq", type: "string", value: "error" }], [{ operator: "count", alias: "count" }], ["name", "attrs.tool.name", "error"]);
    case "chat_timeline":
      return { ...base, view: "events", limit, parameters: { datasets: ["cloudflare-workers"], filters: span(extra, service) } };
  }
}

type Aggregate = { groups?: Array<{ key: string; value: unknown }>; value?: number };
type CalculationResult = { alias?: string; calculation?: string; aggregates?: Aggregate[] };
type EventResult = { timestamp?: number; source?: Record<string, unknown> };

function round(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.abs(value) < 1 ? Number(value.toFixed(4)) : Math.round(value);
}

export function brainRows(result: unknown): Array<Record<string, unknown>> {
  const body = (result ?? {}) as { calculations?: CalculationResult[]; events?: { events?: EventResult[] } };
  if (body.events?.events) {
    return body.events.events.map((event) => {
      const source = event.source ?? {};
      const attrs = (source.attrs ?? {}) as Record<string, unknown>;
      const pick = (path: string) => attrs[path] ?? path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), attrs);
      return {
        at: event.timestamp ? new Date(event.timestamp).toISOString() : undefined,
        name: source.name,
        ms: source.durMs,
        status: source.status,
        phase: attrs.phase,
        tool: pick("tool.name"),
        model: attrs.model,
        cost: pick("cost.total"),
        error: source.error,
      };
    });
  }
  const rows = new Map<string, Record<string, unknown>>();
  for (const calculation of body.calculations ?? []) {
    const alias = calculation.alias ?? calculation.calculation ?? "value";
    for (const aggregate of calculation.aggregates ?? []) {
      const groups = aggregate.groups ?? [];
      const key = JSON.stringify(groups.map((group) => group.value));
      const row = rows.get(key) ?? Object.fromEntries(groups.map((group) => [group.key.replace(/^attrs\./, ""), group.value]));
      row[alias] = round(aggregate.value);
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

export async function askBrain(config: BrainConfig, args: BrainArgs, now = Date.now()): Promise<{ question: BrainQuestion; hours: number; rows: Array<Record<string, unknown>> }> {
  const load = config.fetch ?? fetch;
  const response = await load(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/workers/observability/telemetry/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    body: JSON.stringify(brainQuery(args, config.service, now)),
  });
  const body = (await response.json().catch(() => null)) as { success?: boolean; result?: unknown; errors?: Array<{ message?: string }> } | null;
  if (!response.ok || !body?.success) throw new Error(`Observability query failed (HTTP ${response.status}): ${body?.errors?.map((error) => error.message).join("; ") || "no detail"}`);
  return { question: args.question, hours: Math.min(Math.max(args.hours ?? 24, 1), MAX_HOURS), rows: brainRows(body.result) };
}

export const BRAIN_INSTRUCTIONS = "brain_query reads the owner's own Pi chat traces: every turn, model request (tokens, cost) and tool call, with durations and errors, across all chats, for up to 7 days. It holds IDs and timings, never message content; use search_conversations for content. Use it to answer questions about speed, cost, failures and tool use, including about this chat.";

export function brainToolsExtension(config: () => BrainConfig | null) {
  const query = defineTool({
    name: "brain_query",
    description: `Query the owner's Pi chat traces. question: slowest_steps (p99/median by step and tool), tool_usage (calls, failures, time per tool), model_cost (cost and tokens by model and chat), errors (failed steps), chat_timeline (recent steps, newest first). Optional: hours (1-${MAX_HOURS}, default 24), chat (chat id), tool (tool name), limit (default 15).`,
    parameters: obj({
      question: oneOf([...BRAIN_QUESTIONS]),
      hours: opt(num()),
      chat: opt(str({ description: "Chat id to scope to" })),
      tool: opt(str({ description: "Tool name to scope to, e.g. mcp__radar__top" })),
      limit: opt(num()),
    }),
    replay: "safe",
    execute: async (args, _api, context) => {
      const settings = config();
      if (!settings) return { output: [{ type: "text" as const, text: "brain_query is not set up: this deployment has no OBSERVABILITY_API_TOKEN secret (a Cloudflare API token with Workers Observability read)." }] };
      const answer = await awaitWithContext(askBrain(settings, args as BrainArgs), context);
      return { output: [{ type: "text" as const, text: clipToolOutput(JSON.stringify(answer)) }] };
    },
  });
  return defineExtension({ name: "myax.brain", tools: [query], sections: [section("myax-brain", () => (config() ? BRAIN_INSTRUCTIONS : ""))] });
}

import { num, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { awaitWithContext } from "@earendil-works/chord/context";
import { clipToolOutput } from "./workspace-tools";

export const BRAIN_QUESTIONS = ["slowest_steps", "tool_usage", "model_cost", "errors", "chat_timeline"] as const;
export type BrainQuestion = (typeof BRAIN_QUESTIONS)[number];

export type BrainArgs = { question: BrainQuestion; hours?: number; chat?: string; tool?: string; limit?: number };

const MAX_HOURS = 24 * 90;
const MAX_LIMIT = 50;

type Query = { sql: string; params: Array<string | number> };

export function brainWindow(args: BrainArgs): { hours: number; limit: number } {
  return { hours: Math.min(Math.max(args.hours ?? 24, 1), MAX_HOURS), limit: Math.min(Math.max(Math.floor(args.limit ?? 15), 1), MAX_LIMIT) };
}

export function brainQuery(args: BrainArgs, ownerEmail: string, now: number): Query {
  const { hours, limit } = brainWindow(args);
  const where = ["owner_email = ?", "started_ms >= ?"];
  const params: Array<string | number> = [ownerEmail.toLowerCase(), now - hours * 3_600_000];
  if (args.chat) { where.push("chat_id = ?"); params.push(args.chat); }
  if (args.tool) { where.push("tool_name = ?"); params.push(args.tool); }
  const scope = (extra: string[] = []) => [...where, ...extra].join(" AND ");
  const done = (sql: string) => ({ sql: `${sql} LIMIT ?`, params: [...params, limit] });
  switch (args.question) {
    case "slowest_steps":
      return done(`SELECT name, phase, tool_name AS tool, COUNT(*) AS count, MAX(dur_ms) AS max_ms, CAST(AVG(dur_ms) AS INTEGER) AS avg_ms, SUM(dur_ms) AS total_ms FROM pi_spans WHERE ${scope(["name != 'pi.durable.submit'"])} GROUP BY name, phase, tool_name ORDER BY max_ms DESC`);
    case "tool_usage":
      return done(`SELECT tool_name AS tool, COUNT(*) AS calls, SUM(status = 'error') AS failures, CAST(AVG(dur_ms) AS INTEGER) AS avg_ms, MAX(dur_ms) AS max_ms, SUM(dur_ms) AS total_ms FROM pi_spans WHERE ${scope(["task_name = 'pi.tool'", "phase = 'call'"])} GROUP BY tool_name ORDER BY calls DESC`);
    case "model_cost":
      return done(`SELECT model, chat_id AS chat, COUNT(*) AS requests, ROUND(SUM(cost_usd), 4) AS cost_usd, SUM(input_tokens) AS input_tokens, SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_write_tokens) AS cache_write_tokens, SUM(output_tokens) AS output_tokens, CAST(AVG(dur_ms) AS INTEGER) AS avg_ms FROM pi_spans WHERE ${scope(["name = 'pi.ai.request'"])} GROUP BY model, chat_id ORDER BY cost_usd DESC`);
    case "errors":
      return done(`SELECT name, phase, tool_name AS tool, error, COUNT(*) AS count, MAX(started_ms) AS last_ms FROM pi_spans WHERE ${scope(["status = 'error'"])} GROUP BY name, phase, tool_name, error ORDER BY count DESC`);
    case "chat_timeline":
      return done(`SELECT started_ms, chat_id AS chat, name, phase, tool_name AS tool, model, status, dur_ms, cost_usd, error FROM pi_spans WHERE ${scope()} ORDER BY started_ms DESC`);
  }
}

function tidy(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) continue;
    if ((key === "started_ms" || key === "last_ms") && typeof value === "number") out[key === "started_ms" ? "at" : "last_at"] = new Date(value).toISOString();
    else out[key] = value;
  }
  return out;
}

export async function askBrain(db: D1Database, ownerEmail: string, args: BrainArgs, now = Date.now()): Promise<{ question: BrainQuestion; hours: number; rows: Array<Record<string, unknown>> }> {
  const query = brainQuery(args, ownerEmail, now);
  const result = await db.prepare(query.sql).bind(...query.params).all<Record<string, unknown>>();
  return { question: args.question, hours: brainWindow(args).hours, rows: (result.results ?? []).map(tidy) };
}

export const BRAIN_INSTRUCTIONS = "brain_query reads the owner's own Pi chat traces: every turn, model request (tokens, cost) and tool call, with durations and errors, across all chats, for up to 90 days. It holds IDs and timings, never message content; use search_conversations for content. Use it to answer questions about speed, cost, failures and tool use, including about this chat.";

export function brainToolsExtension(db: () => D1Database, owner: () => string) {
  const query = defineTool({
    name: "brain_query",
    description: `Query the owner's Pi chat traces. question: slowest_steps (slowest steps and tools), tool_usage (calls, failures, time per tool), model_cost (cost and tokens by model and chat), errors (failed steps), chat_timeline (recent steps, newest first). Optional: hours (1-${MAX_HOURS}, default 24), chat (chat id), tool (tool name), limit (default 15, max ${MAX_LIMIT}).`,
    parameters: obj({
      question: oneOf([...BRAIN_QUESTIONS]),
      hours: opt(num()),
      chat: opt(str({ description: "Chat id to scope to" })),
      tool: opt(str({ description: "Tool name to scope to, e.g. mcp__radar__top" })),
      limit: opt(num()),
    }),
    replay: "safe",
    execute: async (args, _api, context) => {
      const answer = await awaitWithContext(askBrain(db(), owner(), args as BrainArgs), context);
      return { output: [{ type: "text" as const, text: clipToolOutput(JSON.stringify(answer)) }] };
    },
  });
  return defineExtension({ name: "myax.brain", tools: [query], sections: [section("myax-brain", () => BRAIN_INSTRUCTIONS)] });
}

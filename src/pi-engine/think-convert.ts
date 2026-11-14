import type { ForkEntry } from "./fork";

type ThinkPart = { type?: string; text?: string; toolCallId?: string; toolName?: string; input?: unknown; output?: unknown; errorText?: string; state?: string };
type ThinkMessage = { role?: string; parts?: ThinkPart[]; createdAt?: string | number | Date };

function timestampOf(message: ThinkMessage, fallback: number): number {
  const value = message.createdAt instanceof Date ? message.createdAt.getTime() : typeof message.createdAt === "string" ? Date.parse(message.createdAt) : message.createdAt;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toolNameOf(part: ThinkPart): string {
  if (part.toolName) return part.toolName;
  return (part.type ?? "tool-unknown").replace(/^tool-/, "");
}

function resultText(part: ThinkPart): string {
  if (typeof part.output === "string") return part.output;
  if (part.output !== undefined) return JSON.stringify(part.output);
  return part.errorText ?? "No result was recorded for this tool call.";
}

export function thinkMessagesToPiEntries(messages: readonly ThinkMessage[], now = Date.now()): ForkEntry[] {
  const entries: ForkEntry[] = [];
  messages.forEach((message, index) => {
    const timestamp = timestampOf(message, now - (messages.length - index) * 1000);
    const parts = message.parts ?? [];
    if (message.role === "user") {
      const text = parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
      if (text.trim()) entries.push({ kind: "pi.user", model: [{ role: "user", content: text, timestamp }] });
      return;
    }
    if (message.role !== "assistant") return;
    const content: Array<Record<string, unknown>> = [];
    const results: ForkEntry[] = [];
    for (const part of parts) {
      if (part.type === "text" && part.text) content.push({ type: "text", text: part.text });
      else if (part.type === "reasoning" && part.text?.trim()) content.push({ type: "thinking", thinking: part.text });
      else if (part.type?.startsWith("tool-") && part.toolCallId) {
        content.push({ type: "toolCall", id: part.toolCallId, name: toolNameOf(part), arguments: (part.input as Record<string, unknown>) ?? {} });
        const isError = part.state === "output-error" || part.state === "output-denied" || part.output === undefined;
        results.push({ kind: "pi.tool-result", model: [{ role: "toolResult", toolCallId: part.toolCallId, toolName: toolNameOf(part), content: [{ type: "text", text: resultText(part) }], isError, timestamp }] });
      }
    }
    if (!content.length) return;
    entries.push({ kind: "pi.assistant", model: [{ role: "assistant", content, api: "imported", provider: "imported", model: "think", usage: emptyUsage(), stopReason: results.length ? "toolUse" : "stop", timestamp }] });
    entries.push(...results);
  });
  return entries;
}

export const IMPORTED_CONTEXT_ROW_LIMIT = 400;

export function dropLeadingNonUserRows<T extends { role: string }>(rows: readonly T[]): T[] {
  const firstUser = rows.findIndex((row) => row.role === "user");
  return firstUser < 0 ? [] : rows.slice(firstUser);
}

export function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

export type TranscriptRow = { ts: string; role: string; tool: string | null; is_error: number; content: string | null; meta_json: string | null };

function metaOf(row: TranscriptRow): Record<string, unknown> {
  try { return row.meta_json ? (JSON.parse(row.meta_json) as Record<string, unknown>) : {}; } catch { return {}; }
}

export function transcriptRowsToPiEntries(rows: readonly TranscriptRow[]): ForkEntry[] {
  const messages: ThinkMessage[] = [];
  let assistant: ThinkMessage | null = null;
  rows.forEach((row, index) => {
    const meta = metaOf(row);
    if (row.role === "user") {
      assistant = null;
      messages.push({ role: "user", parts: [{ type: "text", text: row.content ?? "" }], createdAt: row.ts });
      return;
    }
    if (row.role !== "assistant" && row.role !== "tool") return;
    if (!assistant) { assistant = { role: "assistant", parts: [], createdAt: row.ts }; messages.push(assistant); }
    if (row.role === "tool") {
      const toolCallId = typeof meta.toolCallId === "string" ? meta.toolCallId : `d1-tool-${index}`;
      assistant.parts!.push({ type: `tool-${row.tool ?? "unknown"}`, toolName: row.tool ?? "unknown", toolCallId, input: meta.args ?? {}, output: row.content ?? "", state: row.is_error ? "output-error" : "output-available" });
      return;
    }
    if (typeof meta.reasoning === "string" && meta.reasoning.trim()) assistant.parts!.push({ type: "reasoning", text: meta.reasoning });
    if (row.content) assistant.parts!.push({ type: "text", text: row.content });
    assistant = null;
  });
  return thinkMessagesToPiEntries(messages);
}

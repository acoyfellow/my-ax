import { createHash } from "node:crypto";

const hex = (text, length) => createHash("sha256").update(text).digest("hex").slice(0, length);

function stamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function toolNames(content) {
  return Array.isArray(content) ? content.filter((part) => part?.type === "toolCall").map((part) => ({ id: part.id, name: part.name })) : [];
}

export function sessionSpans(lines, since = 0) {
  let sessionId = null;
  const spans = [];
  const calls = new Map();
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type === "session") { sessionId = entry.id; continue; }
    if (entry.type !== "message" || !sessionId || typeof entry.id !== "string") continue;
    const message = entry.message ?? {};
    const endedMs = stamp(message.timestamp) ?? stamp(entry.timestamp);
    if (endedMs === null) continue;
    const traceId = hex(`${sessionId}:${entry.parentId ?? entry.id}`, 32);
    if (message.role === "assistant" && message.usage) {
      for (const call of toolNames(message.content)) calls.set(call.id, call.name);
      if (endedMs < since) continue;
      const durMs = Math.max(0, Number(message.durationMs) || 0);
      const usage = message.usage;
      spans.push({
        span_id: hex(`${sessionId}:${entry.id}`, 16),
        trace_id: traceId,
        chat_id: sessionId,
        name: "pi.ai.request",
        status: message.stopReason === "error" ? "error" : "ok",
        error: message.stopReason === "error" ? String(message.errorMessage ?? "model error").slice(0, 300) : undefined,
        started_ms: endedMs - durMs,
        dur_ms: durMs,
        model: typeof message.model === "string" ? message.model : undefined,
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_read_tokens: usage.cacheRead,
        cache_write_tokens: usage.cacheWrite,
        cost_usd: usage.cost?.total,
      });
    } else if (message.role === "toolResult") {
      if (endedMs < since) continue;
      const durMs = Math.max(0, Number(message.durationMs) || 0);
      spans.push({
        span_id: hex(`${sessionId}:${entry.id}`, 16),
        trace_id: traceId,
        chat_id: sessionId,
        name: "pi.durable.phase",
        phase: "call",
        task_name: "pi.tool",
        tool_name: message.toolName ?? calls.get(message.toolCallId),
        status: message.isError ? "error" : "ok",
        error: message.isError ? "tool error" : undefined,
        started_ms: endedMs - durMs,
        dur_ms: durMs,
      });
    }
  }
  return spans;
}

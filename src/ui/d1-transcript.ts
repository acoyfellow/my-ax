import { parseCodeDiffReceipt } from "../code-diff";

type D1Entry = {
  id: string | number;
  role?: unknown;
  tool?: unknown;
  isError?: unknown;
  content?: unknown;
  createdAt?: unknown;
  meta?: unknown;
};

type ToolPart = {
  kind: "tool";
  tool: {
    id: string;
    name: string;
    arguments: unknown;
    state: "done" | "error";
    startedAt: number;
    elapsedText: string;
    result: unknown;
    isError: boolean;
  };
};

type TextPart = { kind: "text"; text: string; rendered?: string };

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function timestamp(value: unknown): number {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : Date.now();
}

function codeDiffResult(value: string, toolName: string, isError: boolean): unknown {
  if (toolName !== "show_diff" || isError) return value;
  try {
    const parsed = parseCodeDiffReceipt(JSON.parse(value));
    return parsed ?? value;
  } catch {
    return value;
  }
}

export function d1EntryToTranscriptMessage(entry: D1Entry, renderMarkdown: (text: string) => string) {
  const content = typeof entry.content === "string" ? entry.content : "";
  const id = `d1-${entry.id}`;
  const createdAt = timestamp(entry.createdAt);
  if (entry.role !== "tool") {
    const role = entry.role === "assistant" || entry.role === "user" || entry.role === "error" ? entry.role : "system";
    const part: TextPart = { kind: "text", text: content, ...(role === "assistant" ? { rendered: renderMarkdown(content) } : {}) };
    return { id, role, content, parts: [part], timestamp: createdAt, streaming: false, pending: false };
  }

  const toolName = typeof entry.tool === "string" && entry.tool ? entry.tool : "tool";
  const isError = entry.isError === true || entry.isError === 1;
  const meta = objectValue(entry.meta);
  const toolPart: ToolPart = {
    kind: "tool",
    tool: {
      id,
      name: toolName,
      arguments: meta.args ?? {},
      state: isError ? "error" : "done",
      startedAt: createdAt,
      elapsedText: "",
      result: codeDiffResult(content, toolName, isError),
      isError,
    },
  };
  return { id, role: "assistant" as const, content: "", parts: [toolPart], timestamp: createdAt, streaming: false, pending: false };
}

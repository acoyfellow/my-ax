export type PiContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: string; [key: string]: unknown };

export type PiEntry = { id: number; kind: string; model?: Array<Record<string, unknown>> };

export type PiToolRow = { id: string; name: string; summary: string; output: string; isError: boolean; done: boolean };

export type PiRow =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; text: string; thinking: string; tools: PiToolRow[]; streaming: boolean }
  | { kind: "error"; key: string; text: string };

export type PiLiveView = {
  busy: boolean;
  model: string;
  entries: PiEntry[];
  partial: Record<string, unknown> | null;
  tools: Array<{ callId: string; name: string; status: string; output?: string }>;
  queued: number;
  retry: { at: number; error: string } | null;
};

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (block && typeof block === "object" && (block as { type?: string }).type === "text" ? String((block as { text?: unknown }).text ?? "") : "")).join("");
}

function blocks(message: Record<string, unknown>): PiContentBlock[] {
  return Array.isArray(message.content) ? (message.content as PiContentBlock[]) : [];
}

export function toolCallSummary(args: Record<string, unknown>): string {
  const preferred = args.command ?? args.path ?? args.query;
  const raw = typeof preferred === "string" ? preferred : JSON.stringify(args);
  return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw;
}

function assistantRow(key: string, message: Record<string, unknown>, streaming: boolean): Extract<PiRow, { kind: "assistant" }> {
  const content = blocks(message);
  return {
    kind: "assistant",
    key,
    text: content.filter((block) => block.type === "text").map((block) => String((block as { text?: unknown }).text ?? "")).join(""),
    thinking: content.filter((block) => block.type === "thinking").map((block) => String((block as { thinking?: unknown }).thinking ?? "")).join(""),
    tools: content.filter((block) => block.type === "toolCall").map((block) => {
      const call = block as { id?: unknown; name?: unknown; arguments?: unknown };
      const args = call.arguments && typeof call.arguments === "object" ? (call.arguments as Record<string, unknown>) : {};
      return { id: String(call.id ?? ""), name: String(call.name ?? "tool"), summary: toolCallSummary(args), output: "", isError: false, done: false };
    }),
    streaming,
  };
}

export function buildPiRows(view: Pick<PiLiveView, "entries" | "partial" | "tools">): PiRow[] {
  const rows: PiRow[] = [];
  const toolsById = new Map<string, PiToolRow>();
  for (const entry of view.entries) {
    for (const [index, message] of (entry.model ?? []).entries()) {
      const key = `${entry.id}:${index}`;
      const role = message.role;
      if (entry.kind === "pi.user" && role === "user") rows.push({ kind: "user", key, text: textOf(message.content) });
      if (role === "assistant") {
        const row = assistantRow(key, message, false);
        for (const tool of row.tools) toolsById.set(tool.id, tool);
        const errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : "";
        if (row.text || row.thinking || row.tools.length) rows.push(row);
        if (message.stopReason === "error" && errorMessage) rows.push({ kind: "error", key: `${key}:error`, text: errorMessage });
      }
      if (role === "toolResult") {
        const tool = toolsById.get(String(message.toolCallId ?? ""));
        if (tool) {
          tool.output = textOf(message.content);
          tool.isError = message.isError === true;
          tool.done = true;
        }
      }
    }
  }
  for (const slot of view.tools) {
    const tool = toolsById.get(slot.callId);
    if (tool && !tool.done) tool.output = slot.output ?? "";
  }
  if (view.partial) rows.push(assistantRow("partial", view.partial, true));
  return rows;
}

export type PiComposerAction = "send" | "queue";

export function composerAction(busy: boolean): PiComposerAction {
  return busy ? "queue" : "send";
}

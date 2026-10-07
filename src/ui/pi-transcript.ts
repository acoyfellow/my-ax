export type PiToolState = "pending" | "done" | "error";

export type PiChatPart =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: { id: string; name: string; arguments: Record<string, unknown>; state: PiToolState; result?: string; isError?: boolean } };

export type PiChatMessage = {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  parts: PiChatPart[];
  reasoning?: string;
  attachments?: Array<{ key: string; mime?: string }>;
  timestamp?: number;
  endedAt?: number;
  streaming: boolean;
};

type ModelMessage = Record<string, unknown>;
export type PiEntry = { id: number; kind: string; model?: ModelMessage[] };
export type PiSnapshot = {
  busy: boolean;
  model: string;
  entries: PiEntry[];
  partial: ModelMessage | null;
  tools: Array<{ callId: string; output?: string }>;
  queued: number;
};

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (block && typeof block === "object" && (block as { type?: string }).type === "text" ? String((block as { text?: unknown }).text ?? "") : "")).join("");
}

function assistantParts(message: ModelMessage): { parts: PiChatPart[]; reasoning: string } {
  const parts: PiChatPart[] = [];
  let reasoning = "";
  for (const block of Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : []) {
    if (block.type === "text" && typeof block.text === "string" && block.text) parts.push({ kind: "text", text: block.text });
    if (block.type === "thinking" && typeof block.thinking === "string") reasoning += block.thinking;
    if (block.type === "toolCall") {
      parts.push({ kind: "tool", tool: { id: String(block.id ?? ""), name: String(block.name ?? "tool"), arguments: (block.arguments as Record<string, unknown>) ?? {}, state: "pending" } });
    }
  }
  return { parts, reasoning };
}

export class PiTranscript {
  private entries = new Map<number, PiEntry>();
  partial: ModelMessage | null = null;
  busy = false;
  model = "";
  queued = 0;
  private liveOutput = new Map<string, string>();

  applySnapshot(snapshot: PiSnapshot): void {
    this.entries.clear();
    for (const entry of snapshot.entries) this.entries.set(entry.id, entry);
    this.partial = snapshot.partial;
    this.busy = snapshot.busy;
    this.model = snapshot.model;
    this.queued = snapshot.queued;
    this.liveOutput.clear();
    for (const tool of snapshot.tools) if (tool.output) this.liveOutput.set(tool.callId, tool.output);
  }

  applyEvents(events: ReadonlyArray<Record<string, unknown>>): void {
    for (const event of events) {
      switch (event.type) {
        case "snapshot": {
          const generation = event.generation as { message?: ModelMessage } | undefined;
          this.applySnapshot({
            busy: event.run !== undefined,
            model: this.model,
            entries: (event.entries as PiEntry[]) ?? [],
            partial: generation?.message ?? null,
            tools: (event.tools as PiSnapshot["tools"]) ?? [],
            queued: Array.isArray(event.inbox) ? event.inbox.length : 0,
          });
          break;
        }
        case "run_start": this.busy = true; break;
        case "run_end": this.busy = false; this.partial = null; break;
        case "message_start": {
          const message = event.message as ModelMessage | undefined;
          if (message?.role === "assistant") this.partial = message;
          break;
        }
        case "message_update": this.applyChanges((event.changes as Array<Record<string, unknown>>) ?? []); break;
        case "message_end":
        case "entry_appended":
        case "tool_execution_end": {
          const entry = event.entry as PiEntry | undefined;
          if (entry) this.entries.set(entry.id, entry);
          if (event.type === "message_end" && entry?.model?.some((message) => message.role === "assistant")) this.partial = null;
          break;
        }
        case "tool_execution_update": {
          const id = String(event.toolCallId ?? "");
          const output = event.output as { set?: string; trimStart?: number; append?: string } | undefined;
          if (output?.set !== undefined) this.liveOutput.set(id, output.set);
          else if (output) this.liveOutput.set(id, (this.liveOutput.get(id) ?? "").slice(output.trimStart ?? 0) + (output.append ?? ""));
          break;
        }
        case "inbox_update": this.queued = Array.isArray(event.items) ? event.items.length : 0; break;
        case "agent_changed": {
          const model = (event.agent as { model?: { modelId?: string } } | undefined)?.model?.modelId;
          if (model) this.model = model;
          break;
        }
      }
    }
  }

  private applyChanges(changes: Array<Record<string, unknown>>): void {
    if (!this.partial) this.partial = { role: "assistant", content: [] };
    const content = (Array.isArray(this.partial.content) ? [...(this.partial.content as Array<Record<string, unknown>>)] : []);
    for (const change of changes) {
      const index = Number(change.contentIndex ?? 0);
      if (change.type === "message") { this.partial = change.message as ModelMessage; return; }
      if (change.type === "text_start" || change.type === "thinking_start" || change.type === "toolcall_start" || change.type === "block") content[index] = { ...(change.block as Record<string, unknown>) };
      if (change.type === "text_delta") content[index] = { ...(content[index] ?? { type: "text", text: "" }), text: String(content[index]?.text ?? "") + String(change.delta ?? "") };
      if (change.type === "thinking_delta") content[index] = { ...(content[index] ?? { type: "thinking", thinking: "" }), thinking: String(content[index]?.thinking ?? "") + String(change.delta ?? "") };
    }
    this.partial = { ...this.partial, content };
  }

  messages(): PiChatMessage[] {
    const out: PiChatMessage[] = [];
    const tools = new Map<string, Extract<PiChatPart, { kind: "tool" }>["tool"]>();
    const ordered = [...this.entries.values()].sort((a, b) => a.id - b.id);
    for (const entry of ordered) {
      for (const [index, message] of (entry.model ?? []).entries()) {
        const id = `pi-${entry.id}-${index}`;
        const timestamp = typeof message.timestamp === "number" ? message.timestamp : undefined;
        if (entry.kind === "pi.user" && message.role === "user") {
          out.push({ id, role: "user", content: textOf(message.content), parts: [], timestamp, streaming: false });
        } else if (message.role === "assistant") {
          const { parts, reasoning } = assistantParts(message);
          for (const part of parts) if (part.kind === "tool") tools.set(part.tool.id, part.tool);
          const previous = out[out.length - 1];
          if (previous?.role === "assistant" && !previous.streaming) {
            previous.parts.push(...parts);
            if (timestamp !== undefined) previous.endedAt = timestamp;
            if (reasoning) previous.reasoning = (previous.reasoning ?? "") + reasoning;
          } else if (parts.length || reasoning) {
            out.push({ id, role: "assistant", content: "", parts, reasoning: reasoning || undefined, timestamp, streaming: false });
          }
          if (message.stopReason === "error" && typeof message.errorMessage === "string") {
            out.push({ id: `${id}-error`, role: "error", content: message.errorMessage, parts: [], timestamp, streaming: false });
          }
        } else if (message.role === "toolResult") {
          const tool = tools.get(String(message.toolCallId ?? ""));
          const last = out[out.length - 1];
          if (last?.role === "assistant" && typeof message.timestamp === "number") last.endedAt = message.timestamp;
          if (tool) {
            tool.result = textOf(message.content);
            tool.isError = message.isError === true;
            tool.state = tool.isError ? "error" : "done";
          }
        }
      }
    }
    for (const [callId, output] of this.liveOutput) {
      const tool = tools.get(callId);
      if (tool && tool.state === "pending") tool.result = output;
    }
    if (this.partial) {
      const { parts, reasoning } = assistantParts(this.partial);
      const previous = out[out.length - 1];
      if (previous?.role === "assistant") {
        previous.parts.push(...parts);
        previous.streaming = true;
        if (reasoning) previous.reasoning = (previous.reasoning ?? "") + reasoning;
      } else {
        out.push({ id: "pi-partial", role: "assistant", content: "", parts, reasoning: reasoning || undefined, streaming: true });
      }
    }
    return out;
  }
}

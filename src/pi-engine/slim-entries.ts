export const SLIM_TEXT_LIMIT = 600;
export const SLIM_ENTRY_WINDOW = 80;

type Block = Record<string, unknown>;
type ModelMessage = Record<string, unknown>;
export type SlimmableEntry = { id: number; kind: string; model?: ModelMessage[]; [key: string]: unknown };

function clip(text: string): { text: string; clipped: boolean } {
  if (text.length <= SLIM_TEXT_LIMIT) return { text, clipped: false };
  return { text: text.slice(0, SLIM_TEXT_LIMIT), clipped: true };
}

function clipJsonValue(value: unknown, state: { clipped: boolean }): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:")) return value;
    const result = clip(value);
    state.clipped ||= result.clipped;
    return result.text;
  }
  if (Array.isArray(value)) return value.map((item) => clipJsonValue(item, state));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clipJsonValue(item, state)]));
  return value;
}

function clipToolOutput(text: string): { text: string; clipped: boolean } {
  if (text.length <= SLIM_TEXT_LIMIT) return { text, clipped: false };
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const state = { clipped: false };
      const clipped = clipJsonValue(JSON.parse(text), state);
      return { text: state.clipped ? JSON.stringify(clipped) : text, clipped: state.clipped };
    } catch {}
  }
  return clip(text);
}

function slimArguments(args: unknown): { value: unknown; clipped: boolean } {
  if (!args || typeof args !== "object" || Array.isArray(args)) return { value: args, clipped: false };
  let clipped = false;
  const value: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(args as Record<string, unknown>)) {
    if (typeof field === "string") {
      const result = clip(field);
      clipped ||= result.clipped;
      value[key] = result.text;
    } else value[key] = field;
  }
  return { value, clipped };
}

function slimBlock(block: Block, role: unknown): { block: Block; clipped: boolean } {
  if (block.type === "thinking") {
    const { thinkingSignature: _signature, ...rest } = block;
    return { block: rest, clipped: false };
  }
  if (block.type === "image") return { block: { type: "image", mimeType: block.mimeType, omitted: true }, clipped: true };
  if (block.type === "text" && role === "toolResult" && typeof block.text === "string") {
    const result = clipToolOutput(block.text);
    return { block: { ...block, text: result.text }, clipped: result.clipped };
  }
  if (block.type === "toolCall") {
    const result = slimArguments(block.arguments);
    return { block: { ...block, arguments: result.value }, clipped: result.clipped };
  }
  return { block, clipped: false };
}

const DISPLAY_FIELDS = ["role", "timestamp", "stopReason", "errorMessage", "isError", "toolCallId", "toolName"] as const;

function displayFields(message: ModelMessage): ModelMessage {
  const kept: ModelMessage = {};
  for (const field of DISPLAY_FIELDS) if (message[field] !== undefined) kept[field] = message[field];
  return kept;
}

function slimMessage(message: ModelMessage): { message: ModelMessage; clipped: boolean } {
  if (!Array.isArray(message.content)) return { message: { ...displayFields(message), content: message.content }, clipped: false };
  let clipped = false;
  const content = (message.content as Block[]).map((block) => {
    const result = slimBlock(block, message.role);
    clipped ||= result.clipped;
    return result.block;
  });
  return { message: { ...displayFields(message), content }, clipped };
}

export function slimEntry<T extends SlimmableEntry>(entry: T): T & { clipped?: true } {
  if (!entry.model) return { id: entry.id, kind: entry.kind } as T;
  let clipped = false;
  const model = entry.model.map((message) => {
    const result = slimMessage(message);
    clipped ||= result.clipped;
    return result.message;
  });
  const slim = { id: entry.id, kind: entry.kind, model } as T;
  return clipped ? { ...slim, clipped: true } : slim;
}

export function slimEntries<T extends SlimmableEntry>(entries: readonly T[], window = SLIM_ENTRY_WINDOW): { entries: T[]; olderCount: number } {
  const start = Math.max(0, entries.length - window);
  return { entries: entries.slice(start).map(slimEntry), olderCount: start };
}

type SlimmableEvent = { entry?: unknown; entries?: unknown; message?: unknown; [key: string]: unknown };

function slimPartial(message: unknown): unknown {
  if (!message || typeof message !== "object") return message;
  return slimEntry({ id: 0, kind: "pi.partial", model: [message as ModelMessage] }).model?.[0] ?? message;
}

export function slimEvent<T extends SlimmableEvent>(event: T): T {
  let slim: SlimmableEvent = event;
  if (slim.entry && typeof slim.entry === "object") slim = { ...slim, entry: slimEntry(slim.entry as SlimmableEntry) };
  if (Array.isArray(slim.entries)) slim = { ...slim, entries: slimEntries(slim.entries as SlimmableEntry[]).entries };
  if (slim.message && typeof slim.message === "object" && (slim.message as ModelMessage).role) slim = { ...slim, message: slimPartial(slim.message) };
  return slim as T;
}

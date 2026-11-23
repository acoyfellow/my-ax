export const ATTACH_COMMANDS = { abort: "/abort", quit: "/quit", image: "/image" };

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("");
}

function toolCalls(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((part) => part?.type === "toolCall").map((part) => part.name);
}

function oneLine(text, max = 160) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function entryLines(entry) {
  const message = Array.isArray(entry?.model) ? entry.model[0] : undefined;
  if (!message) return [];
  if (entry.kind === "pi.user") return [`> ${textOf(message.content)}`];
  if (entry.kind === "pi.assistant") {
    const lines = toolCalls(message.content).map((name) => `  · ${name}`);
    const text = textOf(message.content).trim();
    if (text) lines.push(text);
    if (message.stopReason === "error" && message.errorMessage) lines.push(`! ${oneLine(message.errorMessage)}`);
    return lines;
  }
  if (entry.kind === "pi.tool-result" && message.isError) return [`  ! ${message.toolName}: ${oneLine(textOf(message.content))}`];
  if (entry.kind === "pi.compaction") return ["  (earlier turns compacted)"];
  return [];
}

export class AttachView {
  constructor(write) {
    this.write = write;
    this.shown = new Set();
    this.streamed = "";
    this.streaming = false;
  }

  snapshot(view) {
    if (this.shown.size === 0 && view.olderCount > 0) this.write(`  (${view.olderCount} older entries not shown)\n`);
    for (const entry of view.entries ?? []) this.entry(entry);
    if (view.busy) this.write("  … working\n");
  }

  entry(entry) {
    if (typeof entry?.id !== "number" || this.shown.has(entry.id)) return;
    this.shown.add(entry.id);
    const lines = entryLines(entry);
    const streamedText = this.endStream();
    const text = entry.kind === "pi.assistant" ? textOf(entry.model?.[0]?.content).trim() : "";
    for (const line of lines) if (!(streamedText && line === text && streamedText.trim() === text)) this.write(`${line}\n`);
  }

  delta(text) {
    if (!text) return;
    this.streaming = true;
    this.streamed += text;
    this.write(text);
  }

  endStream() {
    if (!this.streaming) return "";
    const text = this.streamed;
    if (!text.endsWith("\n")) this.write("\n");
    this.streamed = "";
    this.streaming = false;
    return text;
  }

  frame(frame) {
    if (frame.type === "pi_snapshot") return this.snapshot(frame.view ?? {});
    if (frame.type === "pi_error") return this.write(`! ${oneLine(frame.message ?? "error")}\n`);
    if (frame.type !== "pi_events") return;
    for (const event of frame.events ?? []) {
      if (event.type === "run_end") this.onSettled?.();
      else if (event.type === "entry_appended") { this.entry(event.entry); if (event.entry?.kind === "pi.tool-result" && event.entry.model?.[0]?.toolName === "ask_user") this.onSettled?.(); }
      else if (event.type === "message_update") for (const change of event.changes ?? []) { if (change.type === "text_delta") this.delta(change.delta); }
      else if (event.type === "message_end" && event.message?.stopReason === "error") { this.endStream(); this.write(`! ${oneLine(event.message.errorMessage ?? "turn failed")}\n`); }
    }
  }
}

const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

export function imageType(path) {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? null : IMAGE_TYPES[path.slice(dot).toLowerCase()] ?? null;
}

export function parseImageCommand(line) {
  const text = line.trim();
  if (!text.startsWith(`${ATTACH_COMMANDS.image} `)) return null;
  const rest = text.slice(ATTACH_COMMANDS.image.length + 1).trim();
  const quoted = rest.match(/^"([^"]+)"\s*(.*)$/) ?? rest.match(/^'([^']+)'\s*(.*)$/);
  const [path, message] = quoted ? [quoted[1], quoted[2]] : [rest.split(/\s+/)[0], rest.slice(rest.split(/\s+/)[0].length).trim()];
  return path ? { path: path.replace(/^~(?=\/)/, process.env.HOME ?? "~"), message } : null;
}

export function decisionPrompt(decision) {
  return [`? ${decision.question}`, ...decision.options.map((option, index) => `  ${index + 1}) ${option}`), "  answer with a number"].join("\n") + "\n";
}

export function decisionChoice(decision, line) {
  const text = line.trim();
  const index = Number(text);
  if (Number.isInteger(index) && index >= 1 && index <= decision.options.length) return decision.options[index - 1];
  return decision.options.find((option) => option.toLowerCase() === text.toLowerCase()) ?? null;
}

export function inputFrame(line, operationId) {
  const text = line.trim();
  if (!text) return null;
  if (text === ATTACH_COMMANDS.abort) return { type: "pi_abort" };
  return { type: "pi_submit", text, operationId };
}

export function reconnectDelay(attempt) {
  return Math.min(500 * 2 ** Math.max(attempt - 1, 0), 15_000);
}

export function pickChat(sessions, query) {
  const chats = sessions.filter((session) => session.engine === "pi");
  const exact = chats.find((chat) => chat.id === query);
  if (exact) return exact;
  const needle = query.toLowerCase();
  const byPrefix = chats.filter((chat) => chat.id.startsWith(needle));
  if (byPrefix.length === 1) return byPrefix[0];
  const byName = chats.filter((chat) => (chat.name ?? "").toLowerCase().includes(needle));
  return byName.length === 1 ? byName[0] : null;
}

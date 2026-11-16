export type MidTurn = "queue" | "steer" | "ask" | "interrupt" | "tandem";
export type MidTurnAction = "queue" | "steer" | "ask" | "interrupt" | "tandem";

export const ASK_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
export const ASK_MAX_CHARS = 2000;

const QUESTION_START = /^(what|whats|what's|how|why|where|when|who|which|is|are|am|was|were|did|does|do|can|could|will|would|should|has|have|any|status|eta)\b/i;

export function isQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith("?")) return true;
  return QUESTION_START.test(trimmed);
}

export function midTurnAction(midTurn: MidTurn, text: string): MidTurnAction {
  if (midTurn === "ask") return isQuestion(text) ? "ask" : "steer";
  return midTurn;
}

type LiveLike = { busy?: boolean; entries?: readonly unknown[]; tools?: readonly unknown[]; partial?: unknown };

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (record.type === "toolCall" && typeof record.name === "string") return `[called ${record.name} ${clip(JSON.stringify(record.arguments ?? {}), 120)}]`;
    if (record.type === "thinking") return "";
    if ("model" in record) return textOf(record.model);
    if ("content" in record) return textOf(record.content);
    if ("message" in record) return textOf(record.message);
  }
  return "";
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function roleOf(entry: unknown): string {
  if (!entry || typeof entry !== "object") return "entry";
  const record = entry as Record<string, unknown>;
  const model = Array.isArray(record.model) && record.model[0] && typeof record.model[0] === "object" ? (record.model[0] as Record<string, unknown>) : null;
  const message = model ?? (record.message && typeof record.message === "object" ? (record.message as Record<string, unknown>) : record);
  if (typeof message.role === "string") return message.role;
  return typeof record.type === "string" ? record.type : "entry";
}

function toolName(tool: unknown): string {
  if (!tool || typeof tool !== "object") return "tool";
  const record = tool as Record<string, unknown>;
  for (const key of ["toolName", "name", "tool"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  return "tool";
}

export function summarizeLiveState(view: LiveLike, maxEntries = 8): string {
  const head: string[] = [`Agent is ${view.busy ? "working" : "idle"}.`];
  const tools = view.tools ?? [];
  if (tools.length) head.push(`Running now: ${tools.map(toolName).join(", ")}.`);
  const partial = clip(textOf(view.partial), 300);
  if (partial) head.push(`Writing now: ${partial}`);

  const recent = (view.entries ?? [])
    .slice(-maxEntries)
    .map((entry) => {
      const text = clip(textOf(entry), 240);
      return text ? `${roleOf(entry)}: ${text}` : "";
    })
    .filter(Boolean);

  const kept: string[] = [];
  let size = 0;
  for (const line of head) {
    kept.push(line);
    size += line.length + 1;
  }
  const tail: string[] = [];
  for (const line of [...recent].reverse()) {
    if (size + line.length + 1 > ASK_MAX_CHARS) break;
    tail.unshift(line);
    size += line.length + 1;
  }
  return [...kept, ...tail].join("\n");
}

export function askMessages(state: string, question: string): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "You are the fast voice of an agent that is still working. The owner asked a question mid-task.",
        "Answer in at most two short plain sentences, using only the state below.",
        "If the state does not answer the question, say what the agent is doing now and that it does not know yet.",
        "Never say something is done, fixed, deployed or merged unless the state shows a result that proves it.",
        "",
        "STATE:",
        state,
      ].join("\n"),
    },
    { role: "user", content: question.slice(0, 500) },
  ];
}

export function fallbackAnswer(view: LiveLike): string {
  const tools = view.tools ?? [];
  if (tools.length) return `Still working. Right now it is running ${tools.map(toolName).join(", ")}.`;
  if (view.busy) return "Still working on it. No result to report yet.";
  return "It is not working on anything right now.";
}

export function cleanAnswer(raw: unknown): string {
  return clip(typeof raw === "string" ? raw : textOf(raw), 400);
}

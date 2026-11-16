export const TANDEM_ROUTER_MODEL = "@cf/cloudflare/clef";
export const TANDEM_KINDS = ["question", "instruction", "correction", "stop"] as const;
export type TandemKind = (typeof TANDEM_KINDS)[number];

export type TandemRoute = { kind: TandemKind; confidence: number; source: "clef" | "fallback"; ms: number };

export const TANDEM_ROUTER_QUESTION = {
  kind: {
    type: "choice",
    instructions: "The owner sent this message to an agent that is busy working on a task. Classify what the owner wants.",
    criteria: {
      question: "Asks for information or status and expects an answer; does not ask for any change to the work.",
      instruction: "Adds to the work or asks for something extra, without saying the current work is wrong.",
      correction: "Says the current work is wrong or should use something different, so the plan must change.",
      stop: "Asks the agent to stop, cancel or abandon the work.",
    },
  },
} as const;

const STOP_WORDS = /^(stop|cancel|abort|halt|forget it|never ?mind|nvm|wait,? stop)\b/i;
const CORRECTION_START = /^(no|nope|wrong|actually|instead|not that|wait)\b/i;
const QUESTION_START = /^(what|whats|what's|how|why|where|when|who|which|is|are|am|was|were|did|does|do|has|have|any|status|eta)\b/i;

export function fallbackRoute(text: string): TandemKind {
  const trimmed = text.trim();
  if (STOP_WORDS.test(trimmed)) return "stop";
  if (CORRECTION_START.test(trimmed)) return "correction";
  if (trimmed.endsWith("?") || QUESTION_START.test(trimmed)) return "question";
  return "instruction";
}

type ClefAnswer = { answers?: { kind?: { choice?: unknown; confidence?: unknown } } };
type AiRunner = { run(model: string, input: unknown): Promise<unknown> };

export function parseClefRoute(raw: unknown): { kind: TandemKind; confidence: number } | null {
  const kind = (raw as ClefAnswer | null)?.answers?.kind;
  const choice = kind?.choice;
  if (typeof choice !== "string" || !(TANDEM_KINDS as readonly string[]).includes(choice)) return null;
  const confidence = typeof kind?.confidence === "number" ? kind.confidence : 0;
  return { kind: choice as TandemKind, confidence };
}

export async function routeMessage(ai: AiRunner, text: string, clock: () => number = Date.now): Promise<TandemRoute> {
  const started = clock();
  try {
    const raw = await ai.run(TANDEM_ROUTER_MODEL, { state: text.slice(0, 2000), questions: TANDEM_ROUTER_QUESTION });
    const parsed = parseClefRoute(raw);
    if (parsed) return { ...parsed, source: "clef", ms: clock() - started };
  } catch (error) {
    console.error("tandem_route_failed", { err: error instanceof Error ? error.message : String(error) });
  }
  return { kind: fallbackRoute(text), confidence: 0, source: "fallback", ms: clock() - started };
}

export type TandemPlan =
  | { action: "answer" }
  | { action: "steer"; text: string }
  | { action: "stop-at-safe-point"; then: string | null };

export function planFor(kind: TandemKind, text: string): TandemPlan {
  if (kind === "question") return { action: "answer" };
  if (kind === "stop") return { action: "stop-at-safe-point", then: null };
  if (kind === "correction") return { action: "steer", text: `Correction from the owner, apply it before you continue: ${text}` };
  return { action: "steer", text };
}

export const TANDEM_ACK: Record<Exclude<TandemKind, "question">, string> = {
  instruction: "Got it. It goes to the agent after this step.",
  correction: "Got it. The agent changes course after this step.",
  stop: "Stopping after the current step.",
};

export const TANDEM_SAFE_POINT_WAIT_MS = 90_000;

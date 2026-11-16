import type { MidTurn } from "./convo-ask";
import { VOICE_ACK_THRESHOLD_MS, WORK_ACK } from "./voice-narration";

export const CONVO_STYLES = ["standard", "narrated", "instant", "background", "fleet", "draft"] as const;
export type ConvoStyle = (typeof CONVO_STYLES)[number];
export const DEFAULT_CONVO_STYLE: ConvoStyle = "standard";

export type ConvoStyleVoice = {
  readonly ackMs: number;
  readonly checkinMs: number;
  readonly ack: string;
};

export type ConvoStyleSpec = {
  readonly id: ConvoStyle;
  readonly label: string;
  readonly summary: string;
  readonly prompt: string;
  readonly voice: ConvoStyleVoice;
  readonly midTurn: MidTurn;
  readonly midTurnHint: string;
};

const PROOF_RULE =
  "Say that something is done, fixed, deployed or merged only when a tool result in this turn proves it. If it is not proven, say it is not confirmed yet.";

const DEFAULT_ACK = WORK_ACK;

export const CONVO_STYLE_SPECS: Record<ConvoStyle, ConvoStyleSpec> = {
  standard: {
    id: "standard",
    label: "Standard",
    summary: "Works, then answers in full.",
    prompt: "",
    voice: { ackMs: VOICE_ACK_THRESHOLD_MS, checkinMs: 20000, ack: DEFAULT_ACK },
    midTurn: "queue",
    midTurnHint: "Messages wait until it finishes.",
  },
  narrated: {
    id: "narrated",
    label: "Narrated",
    summary: "Short plain updates while it works. Brief final answer.",
    prompt: [
      "While you work, write one short plain sentence before each important step: what you found, what you are changing, what failed, what passed.",
      "Do not narrate routine reads or searches. Group small steps.",
      "End with at most three sentences. Offer the details instead of printing them.",
      PROOF_RULE,
    ].join(" "),
    voice: { ackMs: 800, checkinMs: 10000, ack: DEFAULT_ACK },
    midTurn: "steer",
    midTurnHint: "Messages reach it after its current step.",
  },
  instant: {
    id: "instant",
    label: "Instant answers",
    summary: "Answers your question first, in one line. Speaks up only at milestones.",
    prompt: [
      "Start every reply with a one-sentence direct answer to what the owner just asked. Then do the work.",
      "If the owner asks what you are doing, answer from your current state in one sentence before anything else.",
      "During long work, report only milestones: cause found, tests pass or fail, change shipped.",
      PROOF_RULE,
    ].join(" "),
    voice: { ackMs: 400, checkinMs: 20000, ack: "Got it." },
    midTurn: "ask",
    midTurnHint: "Questions are answered right away. Instructions reach it after its current step.",
  },
  background: {
    id: "background",
    label: "Background",
    summary: "Acknowledges, works quietly, reports once when done.",
    prompt: [
      "Acknowledge the request in one short sentence, then work without progress chatter.",
      "When the work ends, send one report: what changed, how it was checked, what still needs the owner.",
      "If something blocks you or needs a decision, say so at once instead of waiting.",
      PROOF_RULE,
    ].join(" "),
    voice: { ackMs: 800, checkinMs: 45000, ack: "On it. I'll tell you when it's done." },
    midTurn: "steer",
    midTurnHint: "Messages reach it after its current step.",
  },
  fleet: {
    id: "fleet",
    label: "One voice",
    summary: "One voice for many agents: what needs you, then failures, then batched progress.",
    prompt: [
      "Act as the one voice for every agent, job and session you can see. Agents never talk to the owner directly; you do.",
      "Order each report: first what needs the owner's decision, then failures, then a short batched progress line per agent.",
      "Keep progress to one line per agent. Leave out agents with no news.",
      "Name the source of each claim (agent, PR, job or check).",
      "If the owner names an agent in a message, pass the message to that agent and say so.",
      PROOF_RULE,
    ].join(" "),
    voice: { ackMs: 800, checkinMs: 15000, ack: "Got it. Checking the agents." },
    midTurn: "steer",
    midTurnHint: "Messages reach it after its current step. Name an agent to route a message to it.",
  },
  draft: {
    id: "draft",
    label: "Quick draft",
    summary: "A one-line draft answer at once, then the full one.",
    prompt: [
      "Begin with a one-line draft answer marked 'Draft:' so the owner has something at once.",
      "Then check it and give the full answer. If the full answer changes the draft, say what changed.",
      "If the owner interrupts with a change, start again from the change without repeating the old draft.",
      PROOF_RULE,
    ].join(" "),
    voice: { ackMs: 300, checkinMs: 20000, ack: "Sure, one sec." },
    midTurn: "interrupt",
    midTurnHint: "A new message stops the current reply and restarts with your change.",
  },
};

export function parseConvoStyle(value: unknown): ConvoStyle | null {
  return typeof value === "string" && (CONVO_STYLES as readonly string[]).includes(value) ? (value as ConvoStyle) : null;
}

export function convoStyleOf(value: unknown): ConvoStyle {
  return parseConvoStyle(value) ?? DEFAULT_CONVO_STYLE;
}

export function convoStyleSection(style: ConvoStyle): string | undefined {
  const spec = CONVO_STYLE_SPECS[style];
  if (!spec.prompt) return undefined;
  return `## Conversation style: ${spec.label}\nThe owner chose this style for this conversation. It applies to text and voice replies.\n${spec.prompt}`;
}

type StyleDb = { prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null> } } };

export async function readConvoStyle(db: StyleDb, sessionId: string, ownerEmail: string): Promise<ConvoStyle> {
  try {
    const row = await db
      .prepare("SELECT convo_style FROM sessions WHERE id = ? AND owner_email = ?")
      .bind(sessionId, ownerEmail.toLowerCase())
      .first<{ convo_style?: string | null }>();
    return convoStyleOf(row?.convo_style);
  } catch {
    return DEFAULT_CONVO_STYLE;
  }
}

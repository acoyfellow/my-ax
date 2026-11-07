export type ChatMessagePhase = "optimistic" | "streaming" | "settled";

export type ChatMessageFlags = { streaming: boolean; pending: boolean };

const FLAGS: Readonly<Record<ChatMessagePhase, ChatMessageFlags>> = {
  optimistic: { streaming: false, pending: true },
  streaming: { streaming: true, pending: false },
  settled: { streaming: false, pending: false },
};

export function messagePhase(phase: ChatMessagePhase): ChatMessageFlags {
  return { ...FLAGS[phase] };
}

export function phaseOf(flags: ChatMessageFlags): ChatMessagePhase {
  if (flags.pending) return "optimistic";
  return flags.streaming ? "streaming" : "settled";
}

export function initialPhase(role: string, serverStreaming?: boolean): ChatMessagePhase {
  if (serverStreaming !== undefined) return serverStreaming ? "streaming" : "settled";
  return role === "assistant" ? "streaming" : "settled";
}

export function canAcceptDelta(flags: ChatMessageFlags): boolean {
  return phaseOf(flags) !== "optimistic";
}

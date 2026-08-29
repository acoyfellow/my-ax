export const TURN_STALL_MS = 45_000;

export interface PendingToolSnapshot {
  name: string;
  startedAt: number;
}

export interface StallInput {
  now: number;
  composerLocked: boolean;
  socketOpen: boolean;
  alreadySurfaced: boolean;
  lastTurnFrameAt: number;
  pendingTool: PendingToolSnapshot | null;
  stallMs?: number;
}

export type StallVerdict =
  | { kind: "quiet" }
  | { kind: "waiting-on-tool"; toolName: string; elapsedMs: number }
  | { kind: "stalled"; silentMs: number };

export function evaluateTurnStall(input: StallInput): StallVerdict {
  const stallMs = input.stallMs ?? TURN_STALL_MS;
  const silentMs = input.now - input.lastTurnFrameAt;
  if (input.pendingTool) {
    return {
      kind: "waiting-on-tool",
      toolName: input.pendingTool.name,
      elapsedMs: input.now - input.pendingTool.startedAt,
    };
  }
  if (input.alreadySurfaced || !input.composerLocked || !input.socketOpen || silentMs <= stallMs) {
    return { kind: "quiet" };
  }
  return { kind: "stalled", silentMs };
}

export function stallFingerprint(verdict: Extract<StallVerdict, { kind: "stalled" }>): string {
  return "turn-stall:no-frames-past-window";
}

export function stallMessage(verdict: Extract<StallVerdict, { kind: "stalled" }>): string {
  const seconds = Math.floor(verdict.silentMs / 1000);
  return `No response from the agent for ${seconds}s, and no tool is running. The turn may have failed. Send another message to retry or steer.`;
}

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

export interface TurnLogEntry {
  role?: unknown;
  content?: unknown;
  meta?: unknown;
}

function entryStatus(entry: TurnLogEntry): unknown {
  return entry.meta && typeof entry.meta === "object" ? (entry.meta as { status?: unknown }).status : undefined;
}

function isTurnErrorEntry(entry: TurnLogEntry): boolean {
  if (typeof entry.content !== "string" || !entry.content.trim()) return false;
  return entry.role === "error" || (entry.role === "assistant" && entryStatus(entry) === "error");
}

export function persistedTurnError(chronologicalEntries: readonly TurnLogEntry[]): string | null {
  for (let index = chronologicalEntries.length - 1; index >= 0; index--) {
    const entry = chronologicalEntries[index];
    if (entry.role === "user") return null;
    if (isTurnErrorEntry(entry)) return (entry.content as string).trim();
  }
  return null;
}

export function stallSurfaceText(
  verdict: Extract<StallVerdict, { kind: "stalled" }>,
  turnError: string | null,
): string {
  return turnError ?? stallMessage(verdict);
}

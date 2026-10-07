export const TURN_IDLE_LIMIT_MS = 4 * 60 * 1000;
export const TURN_TOOL_LIMIT_MS = 11 * 60 * 1000;
export const TURN_WATCHDOG_INTERVAL_SECONDS = 60;
export const STUCK_TURN_NOTE = "This turn stopped making progress, so My AX ended it. Send a message to continue.";

export type TurnLiveness = {
  active: boolean;
  lastProgressAt: number;
  toolsRunning: number;
};

export type TurnVerdict = "idle" | "healthy" | "stuck";

export type TurnLimits = { idleMs: number; toolMs: number };

export const DEFAULT_TURN_LIMITS: TurnLimits = { idleMs: TURN_IDLE_LIMIT_MS, toolMs: TURN_TOOL_LIMIT_MS };

export function turnLimitsFromEnv(value: string | undefined): TurnLimits {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_TURN_LIMITS;
  return { idleMs: seconds * 1000, toolMs: seconds * 1000 };
}

export function turnProgressLimitMs(toolsRunning: number, limits: TurnLimits = DEFAULT_TURN_LIMITS): number {
  return toolsRunning > 0 ? limits.toolMs : limits.idleMs;
}

export function judgeTurn(liveness: TurnLiveness, now: number, limits: TurnLimits = DEFAULT_TURN_LIMITS): TurnVerdict {
  if (!liveness.active) return "idle";
  return now - liveness.lastProgressAt > turnProgressLimitMs(liveness.toolsRunning, limits) ? "stuck" : "healthy";
}

export class TurnProgressTracker {
  private active = false;
  private lastProgressAt = 0;
  private toolsRunning = 0;

  constructor(private readonly clock: () => number = Date.now) {}

  start(): void {
    this.active = true;
    this.toolsRunning = 0;
    this.lastProgressAt = this.clock();
  }

  progress(): void {
    this.lastProgressAt = this.clock();
  }

  toolStarted(): void {
    this.toolsRunning += 1;
    this.progress();
  }

  toolFinished(): void {
    this.toolsRunning = Math.max(0, this.toolsRunning - 1);
    this.progress();
  }

  finish(): void {
    this.active = false;
    this.toolsRunning = 0;
  }

  snapshot(): TurnLiveness {
    return { active: this.active, lastProgressAt: this.lastProgressAt, toolsRunning: this.toolsRunning };
  }
}

export type ProgressSample = { signature: string; at: number };

export function nextProgressSample(previous: ProgressSample | undefined, signature: string, now: number): ProgressSample {
  return previous && previous.signature === signature ? previous : { signature, at: now };
}

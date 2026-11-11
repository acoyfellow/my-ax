export type GateState = "off" | "listening" | "armed" | "capturing" | "cooldown";

export type GateEvent =
  | { type: "enable" }
  | { type: "disable" }
  | { type: "wake" }
  | { type: "speech-start" }
  | { type: "speech-end" }
  | { type: "tick"; ms: number }
  | { type: "hidden" };

export type GateSnapshot = { state: GateState; elapsedMs: number };

export const ARMED_TIMEOUT_MS = 4000;
export const CAPTURE_MAX_MS = 8000;
export const COOLDOWN_MS = 600;

export function initialGate(): GateSnapshot {
  return { state: "off", elapsedMs: 0 };
}

export function stepGate(snapshot: GateSnapshot, event: GateEvent): GateSnapshot {
  const { state, elapsedMs } = snapshot;

  if (event.type === "disable" || event.type === "hidden") {
    return { state: "off", elapsedMs: 0 };
  }

  if (state === "off") {
    if (event.type === "enable") {
      return { state: "listening", elapsedMs: 0 };
    }
    return snapshot;
  }

  if (event.type === "enable") {
    return snapshot;
  }

  if (state === "listening") {
    if (event.type === "wake") {
      return { state: "armed", elapsedMs: 0 };
    }
    return { state: "listening", elapsedMs: 0 };
  }

  if (state === "armed") {
    if (event.type === "speech-start") {
      return { state: "capturing", elapsedMs: 0 };
    }
    if (event.type === "tick") {
      const ms = event.ms;
      if (!Number.isFinite(ms) || ms < 0) {
        return snapshot;
      }
      const newElapsedMs = elapsedMs + ms;
      if (newElapsedMs >= ARMED_TIMEOUT_MS) {
        return { state: "listening", elapsedMs: 0 };
      }
      return { state: "armed", elapsedMs: newElapsedMs };
    }
    return snapshot;
  }

  if (state === "capturing") {
    if (event.type === "speech-end") {
      return { state: "cooldown", elapsedMs: 0 };
    }
    if (event.type === "tick") {
      const ms = event.ms;
      if (!Number.isFinite(ms) || ms < 0) {
        return snapshot;
      }
      const newElapsedMs = elapsedMs + ms;
      if (newElapsedMs >= CAPTURE_MAX_MS) {
        return { state: "cooldown", elapsedMs: 0 };
      }
      return { state: "capturing", elapsedMs: newElapsedMs };
    }
    return snapshot;
  }

  if (state === "cooldown") {
    if (event.type === "wake" || event.type === "speech-start" || event.type === "speech-end") {
      return snapshot;
    }
    if (event.type === "tick") {
      const ms = event.ms;
      if (!Number.isFinite(ms) || ms < 0) {
        return snapshot;
      }
      const newElapsedMs = elapsedMs + ms;
      if (newElapsedMs >= COOLDOWN_MS) {
        return { state: "listening", elapsedMs: 0 };
      }
      return { state: "cooldown", elapsedMs: newElapsedMs };
    }
    return snapshot;
  }

  return snapshot;
}

export function audioMayLeaveDevice(state: GateState): boolean {
  return state === "capturing";
}

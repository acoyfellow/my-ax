export type SocketConnection =
  | { kind: "connecting"; attempt: number }
  | { kind: "open" }
  | { kind: "waiting"; attempt: number }
  | { kind: "exhausted"; attempt: number }
  | { kind: "closed" };

export type SocketConnectionEvent =
  | { type: "opened" }
  | { type: "dropped"; maxAttempts?: number }
  | { type: "retry_due" }
  | { type: "force_reconnect" }
  | { type: "resume" }
  | { type: "close" };

export type SocketEffect = "none" | "connect" | "schedule_retry" | "close_socket" | "signal_exhausted" | "shutdown";

export function initialSocketConnection(): SocketConnection {
  return { kind: "connecting", attempt: 0 };
}

function attemptOf(state: SocketConnection): number {
  return state.kind === "connecting" || state.kind === "waiting" || state.kind === "exhausted" ? state.attempt : 0;
}

export function nextSocketConnection(state: SocketConnection, event: SocketConnectionEvent): { state: SocketConnection; effect: SocketEffect } {
  if (state.kind === "closed") return { state, effect: "none" };
  switch (event.type) {
    case "opened":
      return { state: { kind: "open" }, effect: "none" };
    case "dropped": {
      const attempt = attemptOf(state) + 1;
      if (event.maxAttempts !== undefined && attempt >= event.maxAttempts) return { state: { kind: "exhausted", attempt }, effect: "signal_exhausted" };
      return { state: { kind: "waiting", attempt }, effect: "schedule_retry" };
    }
    case "retry_due":
      return state.kind === "waiting" ? { state: { kind: "connecting", attempt: state.attempt }, effect: "connect" } : { state, effect: "none" };
    case "force_reconnect":
      if (state.kind === "exhausted") return { state: { kind: "connecting", attempt: 0 }, effect: "connect" };
      if (state.kind === "waiting") return { state: { kind: "connecting", attempt: state.attempt }, effect: "connect" };
      return { state, effect: "close_socket" };
    case "resume":
      return state.kind === "exhausted" ? { state: { kind: "connecting", attempt: 0 }, effect: "connect" } : { state, effect: "none" };
    case "close":
      return { state: { kind: "closed" }, effect: "shutdown" };
  }
}

export function retryDelayMs(attempt: number, random: number): number {
  const baseDelay = Math.min(10_000, 500 * Math.pow(1.5, attempt - 1));
  return baseDelay * (0.85 + random * 0.3);
}

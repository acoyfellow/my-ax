export type StreamingTurnProvenance = "local-submit" | "restored" | "server-resumable" | "adopted";

export type StreamingTurnActivityKind = "none" | "reasoning" | "step" | "tool" | "text" | "replay";

export type StreamingTurnState =
  | { tag: "idle" }
  | {
      tag: "active";
      requestId: string;
      provenance: StreamingTurnProvenance;
      recoveryPending: boolean;
      replaying: boolean;
      streamingMessageId: string | null;
      producedVisibleText: boolean;
      producedToolOutput: boolean;
      lastActivityKind: StreamingTurnActivityKind;
    }
  | { tag: "interrupted"; requestId: string | null; reason: "connection-lost" | "resume-none" | "stale-restore"; error?: string }
  | { tag: "terminal"; outcome: "completed" | "error"; requestId: string | null; error?: string; producedVisibleText: boolean; producedToolOutput: boolean };

export type StreamingTurnFrame = {
  requestId: string | null;
  chunkType?: string;
  error?: string;
  done?: boolean;
  replayComplete?: boolean;
};

export type FrameClassification = "same" | "null-id" | "different" | "adoptable";

export type StreamingTurnEvent =
  | { type: "submit"; requestId: string; clientMessageId?: string }
  | { type: "restore"; requestId: string }
  | { type: "server-resumable"; requestId: string }
  | { type: "adopt"; requestId: string }
  | { type: "resume-requested"; requestId: string }
  | { type: "resume-timeout"; requestId: string }
  | { type: "resume-none"; requestId: string | null }
  | { type: "history-loaded" }
  | { type: "visibility-stale" }
  | { type: "frame"; frame: StreamingTurnFrame }
  | { type: "connection-close" }
  | { type: "session-switch" }
  | { type: "reset" };

export const idleStreamingTurnState: StreamingTurnState = { tag: "idle" };

function active(requestId: string, provenance: StreamingTurnProvenance, patch: Partial<Extract<StreamingTurnState, { tag: "active" }>> = {}): Extract<StreamingTurnState, { tag: "active" }> {
  return {
    tag: "active",
    requestId,
    provenance,
    recoveryPending: false,
    replaying: false,
    streamingMessageId: null,
    producedVisibleText: false,
    producedToolOutput: false,
    lastActivityKind: "none",
    ...patch,
  };
}

function isTerminalFrame(frame: StreamingTurnFrame): boolean {
  return Boolean(frame.error || frame.done);
}

export function classifyFrame(state: StreamingTurnState, frame: StreamingTurnFrame): FrameClassification {
  if (state.tag === "active") {
    if (frame.requestId === null) return "null-id";
    return frame.requestId === state.requestId ? "same" : "different";
  }
  if (state.tag === "idle" && frame.requestId !== null && !isTerminalFrame(frame)) return "adoptable";
  return frame.requestId === null ? "null-id" : "different";
}

function applyNonterminalFrame(state: Extract<StreamingTurnState, { tag: "active" }>, frame: StreamingTurnFrame): StreamingTurnState {
  if (frame.replayComplete) {
    return { ...state, recoveryPending: false, replaying: false, lastActivityKind: "replay" };
  }

  switch (frame.chunkType) {
    case "text-delta":
      return { ...state, producedVisibleText: true, lastActivityKind: "text" };
    case "tool-output-available":
    case "tool-output-error":
      return { ...state, producedToolOutput: true, lastActivityKind: "tool" };
    case "tool-input-start":
    case "tool-input-available":
      return { ...state, lastActivityKind: "tool" };
    case "reasoning-start":
    case "reasoning-delta":
      return { ...state, lastActivityKind: "reasoning" };
    case "start":
    case "start-step":
    case "finish-step":
    case "finish":
      return { ...state, lastActivityKind: "step" };
    default:
      return state;
  }
}

function applyFrame(state: StreamingTurnState, frame: StreamingTurnFrame): StreamingTurnState {
  const classification = classifyFrame(state, frame);

  if (state.tag !== "active") {
    if (classification !== "adoptable") return state;
    const adopted = active(frame.requestId!, "adopted");
    return applyNonterminalFrame(adopted, frame);
  }

  if (classification === "different") return state;

  // Terminal settlement requires same-id correlation. Null-id terminal frames
  // are weaker evidence than different-id frames and must not kill a live turn.
  if (classification === "null-id" && isTerminalFrame(frame)) return state;

  if (frame.error) {
    return {
      tag: "terminal",
      outcome: "error",
      requestId: state.requestId,
      error: frame.error,
      producedVisibleText: state.producedVisibleText,
      producedToolOutput: state.producedToolOutput,
    };
  }
  if (frame.done) {
    return {
      tag: "terminal",
      outcome: "completed",
      requestId: state.requestId,
      producedVisibleText: state.producedVisibleText,
      producedToolOutput: state.producedToolOutput,
    };
  }

  return applyNonterminalFrame(state, frame);
}

export function transition(state: StreamingTurnState, event: StreamingTurnEvent): StreamingTurnState {
  switch (event.type) {
    case "reset":
    case "session-switch":
      return idleStreamingTurnState;
    case "submit":
      return state.tag === "active" ? state : active(event.requestId, "local-submit");
    case "restore":
      return state.tag === "active" ? state : active(event.requestId, "restored");
    case "server-resumable":
      if (state.tag === "active") {
        return state.requestId === event.requestId ? { ...state, provenance: "server-resumable" } : state;
      }
      return active(event.requestId, "server-resumable");
    case "adopt":
      return state.tag === "active" ? state : active(event.requestId, "adopted");
    case "resume-requested":
      return state.tag === "active" && state.requestId === event.requestId
        ? { ...state, recoveryPending: true, replaying: true }
        : state;
    case "resume-timeout":
      return state.tag === "active" && state.requestId === event.requestId
        ? { tag: "interrupted", requestId: state.requestId, reason: "stale-restore" }
        : state;
    case "resume-none":
      return state.tag === "active" && (event.requestId === null || event.requestId === state.requestId)
        ? { tag: "interrupted", requestId: state.requestId, reason: "resume-none" }
        : state;
    case "history-loaded":
      return state.tag === "active" && state.provenance === "restored" && !state.recoveryPending
        ? idleStreamingTurnState
        : state;
    case "visibility-stale":
      return state.tag === "active" && state.recoveryPending
        ? { ...state, recoveryPending: false, replaying: false }
        : state;
    case "connection-close":
      return state;
    case "frame":
      return applyFrame(state, event.frame);
  }
}

export function isComposerLocked(state: StreamingTurnState): boolean {
  return state.tag === "active";
}

export function agentStatusFor(state: StreamingTurnState): "idle" | "thinking" | "running" | "done" {
  if (state.tag === "terminal" && state.outcome === "completed") return "done";
  if (state.tag !== "active") return "idle";
  return state.producedVisibleText ? "running" : "thinking";
}

export function progressEligible(state: StreamingTurnState): boolean {
  return state.tag === "active" && !state.producedVisibleText;
}

export function activeRequestIdOf(state: StreamingTurnState): string | null {
  return state.tag === "active" ? state.requestId : null;
}

export function streamingMessageIdOf(state: StreamingTurnState): string | null {
  return state.tag === "active" ? state.streamingMessageId : null;
}

export function hasProducedOutput(state: StreamingTurnState): boolean {
  if (state.tag === "active" || state.tag === "terminal") return state.producedVisibleText || state.producedToolOutput;
  return false;
}

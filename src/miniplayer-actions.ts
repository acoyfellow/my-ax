export type ControlAction =
  | { type: "send"; sessionId: string; content: string }
  | { type: "stop"; sessionId: string }
  | { type: "expand"; sessionId: string }
  | { type: "switch"; sessionId: string };

export function buildAction(kind: "send" | "stop" | "expand" | "switch", sessionId: string, content?: string): ControlAction {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("missing_session");
  }

  if (kind === "send") {
    const trimmedContent = (content ?? "").trim();
    if (trimmedContent.length === 0) {
      throw new Error("empty_content");
    }
    return { type: "send", sessionId, content: trimmedContent };
  }

  if (kind === "stop" || kind === "expand" || kind === "switch") {
    return { type: kind, sessionId };
  }

  throw new Error("unknown_action");
}

export function canSend(content: string): boolean {
  if (typeof content !== "string") {
    return false;
  }
  const trimmed = content.trim();
  return trimmed.length > 0 && trimmed.length <= 4000;
}

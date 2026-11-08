// Only the decisions route may put a "[decision]" line into a conversation.
// Every other inbound path (session inject, MCP inject and send_and_wait,
// workspace_message) is reachable by an agent, so it must refuse that text.
// Stopgap until decisions are passkey-signed and tools check the signed record.
const FORGED_DECISION = /^\s*\[decision\]/im;

export class ForgedDecisionError extends Error {
  constructor() {
    super("content may not contain a [decision] line; only the decisions route records owner choices");
    this.name = "ForgedDecisionError";
  }
}

export function containsDecisionMarker(content: string): boolean {
  return FORGED_DECISION.test(content);
}

export function assertNotForgedDecision(content: string): void {
  if (containsDecisionMarker(content)) throw new ForgedDecisionError();
}

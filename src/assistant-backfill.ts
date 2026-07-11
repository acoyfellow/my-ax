// Pure selection logic for reconcileAssistantHistory (agent.ts).
//
// The durable D1 transcript only got an assistant row when a turn completed
// normally (onChatResponse). Interrupted/replaced/recovery-exhausted turns left
// the agent's reply only in Think's in-memory this.messages, so restored
// history showed the owner's side but not the agent's. This decides which
// assistant messages carry content worth backfilling; the agent then inserts
// any that are missing (uiMessageId dedup makes the insert idempotent).

export type AssistantLike = {
  id: string;
  role: string;
  text: string;      // extracted visible text
  reasoning: string; // extracted reasoning text
};

/** True when a string has content beyond whitespace AND invisible control /
 *  zero-width / format code points. JS trim() leaves \u200B, \u2060, NUL etc.,
 *  so a stub made only of those would otherwise look like real content. */
export function hasVisibleContent(s: string): boolean {
  // Strip C0/C1 controls, zero-width & word-joiner, BOM, then trim whitespace.
  const stripped = s.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2060\uFEFF]/g, "");
  return stripped.trim().length > 0;
}

/** An assistant message is worth persisting when it carries visible text or
 *  reasoning. Empty placeholders (streaming stubs, tool-only steps) are skipped. */
export function shouldBackfillAssistant(message: AssistantLike): boolean {
  if (message.role !== "assistant") return false;
  // The id is the idempotency key (uiMessageId) for the D1 insert. A blank id
  // cannot be de-duplicated, so never back-fill one.
  if (!message.id || !message.id.trim()) return false;
  return hasVisibleContent(message.text) || hasVisibleContent(message.reasoning);
}

/** The subset of messages that should be considered for D1 backfill. */
export function assistantBackfillCandidates<T extends AssistantLike>(messages: readonly T[]): T[] {
  return messages.filter(shouldBackfillAssistant);
}

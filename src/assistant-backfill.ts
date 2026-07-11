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
  // Strip every control (Cc) and format (Cf) code point — the hand-rolled range
  // missed some (e.g. U+2063 INVISIBLE SEPARATOR) — then trim whitespace. A
  // stub made only of invisible characters must read as empty. Visible text
  // (incl. emoji whose ZWJ joiners are Cf) keeps its base characters.
  const stripped = s.replace(/[\p{Cc}\p{Cf}]/gu, "");
  return stripped.trim().length > 0;
}

/** An assistant message is worth persisting when it carries visible text or
 *  reasoning. Empty placeholders (streaming stubs, tool-only steps) are skipped. */
export function shouldBackfillAssistant(message: AssistantLike): boolean {
  if (message.role !== "assistant") return false;
  // The id is the idempotency key (uiMessageId) for the D1 insert. A blank id
  // — including one made only of whitespace or invisible format characters —
  // cannot be de-duplicated, so never back-fill one.
  if (!message.id || !hasVisibleContent(message.id)) return false;
  return hasVisibleContent(message.text) || hasVisibleContent(message.reasoning);
}

/** The subset of messages that should be considered for D1 backfill. */
export function assistantBackfillCandidates<T extends AssistantLike>(messages: readonly T[]): T[] {
  return messages.filter(shouldBackfillAssistant);
}

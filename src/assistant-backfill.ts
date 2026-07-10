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

/** An assistant message is worth persisting when it carries visible text or
 *  reasoning. Empty placeholders (streaming stubs, tool-only steps) are skipped. */
export function shouldBackfillAssistant(message: AssistantLike): boolean {
  if (message.role !== "assistant") return false;
  return message.text.trim().length > 0 || message.reasoning.trim().length > 0;
}

/** The subset of messages that should be considered for D1 backfill. */
export function assistantBackfillCandidates<T extends AssistantLike>(messages: readonly T[]): T[] {
  return messages.filter(shouldBackfillAssistant);
}

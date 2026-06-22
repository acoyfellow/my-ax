export interface DecisionResponseStore {
  insertEvent(input: { id: string; eventId: string; email: string; question: string; choice: string; now: string }): Promise<void>;
  completeRun(input: { id: string; email: string }): Promise<boolean>;
  deleteEvent(input: { id: string; eventId: string; email: string }): Promise<void>;
}

/**
 * Claim an open decision exactly once while keeping its answer event consistent.
 * Concurrent or repeated submissions lose the conditional status transition.
 */
export async function recordDecisionResponse(
  store: DecisionResponseStore,
  input: { id: string; email: string; question: string; choice: string; now?: string },
): Promise<boolean> {
  const now = input.now ?? new Date().toISOString();
  const eventId = `evt-${crypto.randomUUID()}`;
  const eventInput = { ...input, eventId, now };
  await store.insertEvent(eventInput);
  try {
    const completed = await store.completeRun(input);
    if (!completed) {
      await store.deleteEvent(eventInput);
      return false;
    }
    return true;
  } catch (error) {
    await store.deleteEvent(eventInput).catch(() => undefined);
    throw error;
  }
}

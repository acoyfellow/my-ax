export interface DecisionResponseStore {
  insertEvent(input: { id: string; eventId: string; email: string; question: string; choice: string; now: string }): Promise<void>;
  completeRun(input: { id: string; email: string }): Promise<boolean>;
  reopenRun(input: { id: string; email: string }): Promise<boolean>;
  deleteEvent(input: { id: string; eventId: string; email: string }): Promise<void>;
}

/**
 * Claim an open decision exactly once while keeping its answer event consistent.
 * Concurrent or repeated submissions lose the conditional status transition.
 */
export async function recordDecisionResponse(
  store: DecisionResponseStore,
  input: { id: string; email: string; question: string; choice: string; now?: string },
  resume: () => Promise<void> = async () => undefined,
): Promise<boolean> {
  const now = input.now ?? new Date().toISOString();
  const eventId = `evt-${crypto.randomUUID()}`;
  const eventInput = { ...input, eventId, now };
  await store.insertEvent(eventInput);
  let completed = false;
  try {
    completed = await store.completeRun(input);
  } catch (error) {
    // completeRun itself failed: the claim never took, so drop the event.
    await store.deleteEvent(eventInput).catch(() => undefined);
    throw error;
  }
  if (!completed) {
    await store.deleteEvent(eventInput);
    return false;
  }
  try {
    await resume();
  } catch (error) {
    // The run is claimed/completed. Only remove the answer event once the
    // completion is CONFIRMED rolled back — otherwise a failed reopen would
    // leave a completed run with no answer. And delete exactly once (the old
    // outer catch re-deleted after this path already had).
    const reopened = await store.reopenRun(input).catch(() => false);
    if (!reopened) throw new Error("Failed to reopen decision after resume error", { cause: error });
    await store.deleteEvent(eventInput);
    throw error;
  }
  return true;
}

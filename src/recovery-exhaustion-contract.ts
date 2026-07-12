export interface RecoveryExhaustionContractInput {
  terminalMessage: string;
  incidentId: string;
  reason: string;
  proof?: boolean;
}

export function recoveryExhaustionContract(sessionId: string, input: RecoveryExhaustionContractInput) {
  return {
    transcriptMeta: {
      status: "interrupted",
      recoveryIncidentId: input.incidentId,
      recoveryReason: input.reason,
    },
    notification: {
      kind: "session.update" as const,
      sessionId,
      title: input.proof ? "Recovery receipt proof" : "My AX turn was interrupted",
      body: input.proof
        ? "Controlled proof: recovery exhaustion produced a terminal transcript, interrupted state, and owner receipt."
        : `${input.terminalMessage} Next action: open the conversation and try again.`,
      href: `/?session=${encodeURIComponent(sessionId)}`,
    },
  };
}

/**
 * Ordering guarantee for recordRecoveryExhaustion, kept pure here (this module
 * has no cloudflare: imports) so it is unit-testable under plain tsx. Persist
 * the owner-visible terminal state FIRST (transcript row + the interrupted-
 * status UPDATE, together), and notify ONLY AFTER both durably resolve.
 * Previously all three ran in one Promise.all, so the owner could be pushed a
 * "turn was interrupted" notification even when the status UPDATE rejected — a
 * notification about a terminal state that was never recorded. If persistence
 * throws, the error propagates and notify never runs.
 */
export async function sequenceRecoveryExhaustion(
  logAssistant: () => Promise<unknown>,
  persistStatus: () => Promise<unknown>,
  notify: () => Promise<unknown>,
): Promise<void> {
  await Promise.all([logAssistant(), persistStatus()]);
  await notify();
}

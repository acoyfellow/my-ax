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

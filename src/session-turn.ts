export type SessionTurnStatus = "idle" | "thinking" | "running";

export function sessionRowToTurnStatus(status: string | null | undefined): SessionTurnStatus {
  if (status === "running") return "thinking";
  return "idle";
}

export function sessionTurnLocksComposer(state: Pick<SessionTurnState, "status"> | null | undefined): boolean {
  return state?.status === "thinking";
}

export type SessionTurnState = {
  sessionId: string;
  status: SessionTurnStatus;
  requestId: string | null;
  sessionStatus: string;
  updatedAt: string | null;
};

export function buildSessionTurnState(input: {
  sessionId: string;
  sessionStatus: string | null | undefined;
  requestId?: string | null;
  updatedAt?: string | null;
}): SessionTurnState {
  return {
    sessionId: input.sessionId,
    status: sessionRowToTurnStatus(input.sessionStatus),
    requestId: input.requestId ?? null,
    sessionStatus: input.sessionStatus ?? "active",
    updatedAt: input.updatedAt ?? null,
  };
}

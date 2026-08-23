export interface ClientErrorReport {
  message: string;
  stack?: string;
  sessionId?: string;
}

export function buildClientErrorReport(
  message: string,
  stack?: string,
  sessionId?: string | null,
): ClientErrorReport {
  return {
    message,
    ...(stack ? { stack } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

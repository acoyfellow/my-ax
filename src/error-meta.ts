export function errorConversationMeta(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const meta: Record<string, unknown> = {
      errorName: error.name || "Error",
      errorMessage: error.message,
    };
    if (typeof error.stack === "string" && error.stack.trim()) {
      meta.errorStack = error.stack.slice(0, 3000);
    }
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause !== undefined) {
      meta.errorCause = serializeErrorCause(cause);
    }
    return meta;
  }
  return {
    errorName: typeof error,
    errorMessage: String(error),
  };
}

function serializeErrorCause(cause: unknown): unknown {
  if (cause instanceof Error) {
    return {
      name: cause.name || "Error",
      message: cause.message,
      ...(typeof cause.stack === "string" && cause.stack.trim() ? { stack: cause.stack.slice(0, 1500) } : {}),
    };
  }
  if (typeof cause === "string" || typeof cause === "number" || typeof cause === "boolean" || cause === null) {
    return cause;
  }
  try {
    return JSON.parse(JSON.stringify(cause));
  } catch {
    return String(cause);
  }
}

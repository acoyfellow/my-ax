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
    errorMessage: safeString(error, "[unserializable thrown value]"),
  };
}

// String(value) can itself throw (e.g. a null-prototype object with no primitive
// conversion), which would replace the original failure with a TypeError inside
// an error-reporting helper. Fail soft to a stable placeholder.
function safeString(value: unknown, fallback: string): string {
  try {
    return String(value);
  } catch {
    return fallback;
  }
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
    return safeString(cause, "[unserializable error cause]");
  }
}

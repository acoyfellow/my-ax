// `value instanceof Error` performs getPrototypeOf, which THROWS on a revoked
// proxy — inside an error-reporting helper that would mask the original
// failure. Fail soft to a non-Error classification.
function isError(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

// A `stack` accessor can throw (revoked proxy, hostile getter). Read it once,
// guarded, so error reporting never re-throws while collecting a stack.
function safeStack(getStack: () => unknown): string | undefined {
  let stack: unknown;
  try {
    stack = getStack();
  } catch {
    return undefined;
  }
  return typeof stack === "string" && stack.trim() ? stack : undefined;
}

export function errorConversationMeta(error: unknown): Record<string, unknown> {
  if (isError(error)) {
    const meta: Record<string, unknown> = {
      errorName: error.name || "Error",
      errorMessage: error.message,
    };
    const stack = safeStack(() => error.stack);
    if (stack) {
      meta.errorStack = stack.slice(0, 3000);
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
  if (isError(cause)) {
    const stack = safeStack(() => cause.stack);
    return {
      name: cause.name || "Error",
      message: cause.message,
      ...(stack ? { stack: stack.slice(0, 1500) } : {}),
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

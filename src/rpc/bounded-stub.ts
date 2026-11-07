import { withTimeout } from "./timeout";

export const STUB_RESOLVE_TIMEOUT_MS = 15_000;

export class StubUnavailableError extends Error {
  readonly status = 503;
  constructor(readonly op: string, readonly reason: "timeout" | "error", cause?: unknown) {
    super(reason === "timeout" ? `${op} did not answer within ${STUB_RESOLVE_TIMEOUT_MS}ms` : `${op} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "StubUnavailableError";
  }
}

export async function resolveStub<T>(op: string, resolve: () => Promise<T>, timeoutMs = STUB_RESOLVE_TIMEOUT_MS): Promise<T> {
  const timed = await withTimeout({ promise: resolve(), timeoutMs, op });
  if (timed.ok) return timed.value;
  throw new StubUnavailableError(op, timed.reason, timed.reason === "error" ? timed.error : undefined);
}

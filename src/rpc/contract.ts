import { withRetry } from "./retry";
import { withTimeout } from "./timeout";

export type CallKind = "query" | "command" | "job";

export const QUERY_TIMEOUT_MS = 10_000;
export const COMMAND_TIMEOUT_MS = 30_000;

const RETRY_BACKOFF_ALLOWANCE_MS = 250;

const retryBudget = (timeoutMs: number) => timeoutMs * 2 + RETRY_BACKOFF_ALLOWANCE_MS;

export class RpcTimeoutError extends Error {
  readonly kind: CallKind;
  readonly op: string;
  readonly opId: string | null;

  constructor(kind: CallKind, op: string, timeoutMs: number, opId: string | null) {
    super(kind === "command"
      ? `${op} did not answer within ${timeoutMs}ms. It may still finish.${opId ? ` Its operation id is ${opId}.` : ""}`
      : `${op} did not answer within ${timeoutMs}ms.`);
    this.name = "RpcTimeoutError";
    this.kind = kind;
    this.op = op;
    this.opId = opId;
  }
}

function unwrap<T>(kind: CallKind, op: string, timeoutMs: number, opId: string | null, timed: { ok: true; value: T } | { ok: false; reason: "timeout" } | { ok: false; reason: "error"; error: unknown }): T {
  if (timed.ok) return timed.value;
  if (timed.reason === "timeout") throw new RpcTimeoutError(kind, op, timeoutMs, opId);
  throw timed.error;
}

export async function query<T>(op: string, call: () => Promise<T>, timeoutMs = QUERY_TIMEOUT_MS): Promise<T> {
  const retried = await withRetry({ start: call, op, timeoutMs, maxAttempts: 2, budgetMs: retryBudget(timeoutMs), retryOnTimeout: true });
  if (retried.ok) return retried.value;
  if (retried.reason === "timeout" || retried.reason === "budget") throw new RpcTimeoutError("query", op, timeoutMs, null);
  throw retried.error;
}

export async function command<T>(op: string, call: () => Promise<T>, timeoutMs = COMMAND_TIMEOUT_MS): Promise<T> {
  return unwrap("command", op, timeoutMs, null, await withTimeout({ promise: call(), timeoutMs, op }));
}

export async function idempotentCommand<T>(op: string, opId: string, call: (opId: string) => Promise<T>, timeoutMs = COMMAND_TIMEOUT_MS): Promise<T> {
  const retried = await withRetry({ start: () => call(opId), op, timeoutMs, maxAttempts: 2, budgetMs: retryBudget(timeoutMs), retryOnTimeout: true });
  if (retried.ok) return retried.value;
  if (retried.reason === "timeout" || retried.reason === "budget") throw new RpcTimeoutError("command", op, timeoutMs, opId);
  throw retried.error;
}

export async function startJob<T>(op: string, opId: string, start: (opId: string) => Promise<T>, timeoutMs = COMMAND_TIMEOUT_MS): Promise<T> {
  return unwrap("job", op, timeoutMs, opId, await withTimeout({ promise: start(opId), timeoutMs, op }));
}

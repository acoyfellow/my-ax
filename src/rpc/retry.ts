import { withTimeout, type Timed } from "./timeout";

export type Attempt = { outcome: "ok" | "timeout" | "error"; waitedMs: number; backoffMs: number; error?: unknown };

export type Retried<T> =
  | { ok: true; value: T; attempts: Attempt[] }
  | { ok: false; reason: "timeout" | "error" | "budget"; error?: unknown; attempts: Attempt[] };

export interface RetryOptions<T> {
  start: () => Promise<T>;
  op: string;
  timeoutMs: number;
  budgetMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  retryOnTimeout?: boolean;
  isRetryable?: (error: unknown) => boolean;
  random?: () => number;
}

export async function withRetry<T>(o: RetryOptions<T>): Promise<Retried<T>> {
  const { start, op } = o;
  const maxAttempts = o.maxAttempts ?? 3;
  const budgetMs = o.budgetMs ?? o.timeoutMs * maxAttempts;
  const base = o.baseBackoffMs ?? 100;
  const cap = o.maxBackoffMs ?? 2000;
  const isRetryable = o.isRetryable ?? ((e: any) => !!e?.retryable && !e?.overloaded);
  const random = o.random ?? Math.random;
  const startedAt = Date.now();
  const deadlineAt = startedAt + budgetMs;
  const attempts: Attempt[] = [];

  const done = (r: Retried<T>) => {
    console.log(JSON.stringify({ ev: "rpc.retry", op, outcome: r.ok ? "ok" : r.reason, attempts: attempts.length, attemptOutcomes: attempts.map((a) => a.outcome).join(","), totalMs: Date.now() - startedAt, budgetMs }));
    return r;
  };

  for (let n = 0; n < maxAttempts; n++) {
    const backoffMs = n === 0 ? 0 : Math.round(random() * Math.min(cap, base * 2 ** (n - 1)));
    const remaining = deadlineAt - Date.now() - backoffMs;
    if (remaining < 50) return done({ ok: false, reason: "budget", attempts });
    if (backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs));

    const t0 = Date.now();
    const r: Timed<T> = await withTimeout({ promise: start(), timeoutMs: Math.min(o.timeoutMs, remaining), op });
    const a: Attempt = { outcome: r.ok ? "ok" : r.reason, waitedMs: Date.now() - t0, backoffMs, ...(r.ok || r.reason !== "error" ? {} : { error: r.error }) };
    attempts.push(a);
    if (r.ok) return done({ ok: true, value: r.value, attempts });

    const retry = r.reason === "timeout" ? (o.retryOnTimeout ?? false) : isRetryable(r.error);
    console.log(JSON.stringify({ ev: "rpc.attempt", op, attempt: n, outcome: r.reason, error: r.ok || r.reason !== "error" ? undefined : String(r.error), waitedMs: a.waitedMs, backoffMs, willRetry: retry && n + 1 < maxAttempts }));
    if (!retry) return done({ ok: false, reason: r.reason, ...(r.reason === "error" ? { error: r.error } : {}), attempts });
  }
  const last = attempts[attempts.length - 1]!;
  return done({ ok: false, reason: last.outcome === "error" ? "error" : "timeout", error: last.error, attempts });
}

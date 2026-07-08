// Retry-with-backoff fetch wrapper for the LLM gateway (#6).
//
// The gateway returns "3021: rate limiting: inference request per min rate
// reached" (or HTTP 429 / overloaded) when the per-minute inference cap is hit.
// That is transient — the next attempt shortly after usually succeeds. This
// wrapper retries such responses with bounded backoff (honoring Retry-After
// when present) so a passing rate-limit blip self-heals instead of failing the
// whole turn. Complements the notify-side suppression already shipped.
//
// Deps are injected (fetch/now/sleep/random) so the logic is unit-tested
// without real network or timers. Only the initial response status is
// inspected: a gateway 429 is returned before any stream begins, so retrying
// the fetch is safe and never interrupts an in-flight stream.

import { isTransientRateLimit } from "./upstream-rate-limit";

export type RetryFetchDeps = {
  fetch: typeof fetch;
  maxAttempts?: number; // total attempts including the first. default 3
  baseMs?: number; // exponential backoff base. default 500
  capMs?: number; // per-wait cap. default 8000
  totalCapMs?: number; // total added wait cap across retries. default 15000
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

/** Parse a Retry-After header (delta-seconds or HTTP-date) into ms from now.
 *  Returns null when absent/invalid; clamped to [0, capMs]. */
export function parseRetryAfterMs(value: string | null | undefined, now: number, capMs: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    return Math.max(0, Math.min(ms, capMs));
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, Math.min(dateMs - now, capMs));
  }
  return null;
}

/** Exponential backoff with jitter for attempt N (0-based), capped. */
export function nextBackoffMs(attempt: number, baseMs: number, capMs: number, random: () => number): number {
  const raw = baseMs * Math.pow(2, attempt);
  const jittered = raw * (0.85 + random() * 0.3);
  return Math.min(Math.round(jittered), capMs);
}

/** A rate-limit response is one whose status is 429, or whose status text /
 *  body signal a transient limit. We inspect status + statusText only (we must
 *  not consume the body of a response we intend to return). */
function isRateLimitResponse(res: Response): boolean {
  if (res.status === 429) return true;
  // Some gateways return 200/4xx with a rate-limit statusText or a coded body;
  // we can only cheaply see statusText here without consuming the body.
  return isTransientRateLimit(`${res.status} ${res.statusText}`);
}

/** Wrap a fetch so transient gateway rate limits are retried with bounded
 *  backoff. Non-rate-limit responses (and network errors) pass through
 *  unchanged on the first attempt's result. */
export function createRetryFetch(deps: RetryFetchDeps): typeof fetch {
  const doFetch = deps.fetch;
  const maxAttempts = Math.max(1, deps.maxAttempts ?? 3);
  const baseMs = deps.baseMs ?? 500;
  const capMs = deps.capMs ?? 8000;
  const totalCapMs = deps.totalCapMs ?? 15000;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;

  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let waited = 0;
    let last: Response | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await doFetch(input as Parameters<typeof fetch>[0], init);
      if (!isRateLimitResponse(res)) return res;
      last = res;
      if (attempt === maxAttempts - 1) break; // out of attempts
      const retryAfter = parseRetryAfterMs(res.headers.get("retry-after"), now(), capMs);
      const wait = retryAfter ?? nextBackoffMs(attempt, baseMs, capMs, random);
      if (waited + wait > totalCapMs) break; // don't exceed the total wait budget
      waited += wait;
      await sleep(wait);
    }
    return last!;
  }) as typeof fetch;

  return wrapped;
}

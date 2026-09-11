import { Effect } from "effect";
import { isTransientRateLimit } from "./upstream-rate-limit";

export type RetryFetchDeps = {
  fetch: typeof fetch;
  maxAttempts?: number;
  baseMs?: number;
  capMs?: number;
  totalCapMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

export function parseRetryAfterMs(value: string | null | undefined, now: number, capMs: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Math.max(0, Math.min(Number(trimmed) * 1000, capMs));
  const dateMs = Date.parse(trimmed);
  return Number.isNaN(dateMs) ? null : Math.max(0, Math.min(dateMs - now, capMs));
}

export function nextBackoffMs(attempt: number, baseMs: number, capMs: number, random: () => number): number {
  const raw = baseMs * Math.pow(2, attempt);
  return Math.min(Math.round(raw * (0.85 + random() * 0.3)), capMs);
}

function isRateLimitResponse(response: Response): boolean {
  return response.status === 429 || isTransientRateLimit(`${response.status} ${response.statusText}`);
}

export function retryFetchEffect(deps: RetryFetchDeps, input: RequestInfo | URL, init?: RequestInit): Effect.Effect<Response> {
  const maxAttempts = Math.max(1, deps.maxAttempts ?? 3);
  const baseMs = deps.baseMs ?? 500;
  const capMs = deps.capMs ?? 8000;
  const totalCapMs = deps.totalCapMs ?? 15000;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;

  return Effect.gen(function* () {
    let waited = 0;
    let last: Response | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = yield* Effect.promise(() => deps.fetch.call(globalThis, input as Parameters<typeof fetch>[0], init));
      if (!isRateLimitResponse(response)) return response;
      last = response;
      if (attempt === maxAttempts - 1) break;
      const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"), now(), capMs);
      const wait = retryAfter ?? nextBackoffMs(attempt, baseMs, capMs, random);
      if (waited + wait > totalCapMs) break;
      waited += wait;
      yield* deps.sleep ? Effect.promise(() => deps.sleep!(wait)) : Effect.sleep(wait);
    }
    return last!;
  });
}

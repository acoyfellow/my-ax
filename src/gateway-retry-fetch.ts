import { Effect } from "effect";
import { retryFetchEffect, type RetryFetchDeps } from "./gateway-retry";

export { nextBackoffMs, parseRetryAfterMs, retryFetchEffect, type RetryFetchDeps } from "./gateway-retry";

export function createRetryFetch(deps: RetryFetchDeps): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => Effect.runPromise(retryFetchEffect(deps, input, init))) as typeof fetch;
}

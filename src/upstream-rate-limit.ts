// Classifier for transient upstream (LLM gateway / model provider) rate limits.
//
// The gateway returns errors like:
//   "3021: rate limiting: inference request per min rate reached"
// and providers return HTTP 429 / "rate limit" / "overloaded". These are
// TRANSIENT: the next tick (or a short backoff) usually succeeds. They are not
// an actionable job failure, so we must not surface them as a "<job> failed"
// push on every recurring tick — that is what spammed the owner with
// "rate limit" notifications.
//
// Pure and dependency-free so both the turn retry path and the recurring-job
// receipt path can share one definition.

const PATTERNS: RegExp[] = [
  /\b3021\b/, // Cloudflare Workers AI gateway rate-limit code
  /\brate[\s_-]?limit/i,
  /inference request per min/i,
  /too many requests/i,
  /\b429\b/,
  /\boverloaded\b/i,
  /request per min rate reached/i,
];

/** True when an error string is a transient upstream rate-limit/overload that
 *  should be retried/reschduled rather than reported as a hard failure. */
export function isTransientRateLimit(error: unknown): boolean {
  if (error == null) return false;
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
  if (!text) return false;
  return PATTERNS.some((re) => re.test(text));
}

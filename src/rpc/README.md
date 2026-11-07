# src/rpc

Helpers for calls from a Worker or a Durable Object to another Durable Object.

`timeout.ts`, `retry.ts` and `rpc.test.ts` are copied from Ivar's `rpc-deadline` study (`lib/timeout.ts`, `lib/retry.ts`, `lib/timeout.test.ts`), ISC licence. Comments were removed to match this repo's style. The logic is unchanged.

## Rules

1. A timeout limits how long the caller waits. It does not cancel the call. The callee can still finish after the caller gave up.
2. Do not resend after a timeout unless the method is idempotent and carries an operation id. A resend can run the method twice.
3. Retry only errors marked `retryable` and not `overloaded`. The runtime already retries transport failures.
4. Clear every timer when its work finishes. Do not use `AbortSignal.timeout()` inside a Durable Object, because it cannot be cleared.
5. When the outcome matters after a timeout, have the callee record an operation id with the effect, and read that record.

`scripts/rpc-audit.mjs` checks these rules across `src/`. Calls that are safe without a wrapper are listed in `scripts/rpc-audit.allow.json`, each with a reason.

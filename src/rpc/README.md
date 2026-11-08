# src/rpc

Helpers for calls from a Worker or a Durable Object to another Durable Object.

`timeout.ts`, `retry.ts` and `rpc.test.ts` are copied from Ivar's `rpc-deadline` study (`lib/timeout.ts`, `lib/retry.ts`, `lib/timeout.test.ts`), ISC licence. Comments were removed to match this repo's style. The logic is unchanged.

## Rules

1. A timeout limits how long the caller waits. It does not cancel the call. The callee can still finish after the caller gave up.
2. Do not resend after a timeout unless the method is idempotent and carries an operation id. A resend can run the method twice.
3. Retry only errors marked `retryable` and not `overloaded`. The runtime already retries transport failures.
4. Clear every timer when its work finishes. Do not use `AbortSignal.timeout()` inside a Durable Object, because it cannot be cleared.
5. When the outcome matters after a timeout, have the callee record an operation id with the effect, and read that record.

## Contracts

`contract.ts` gives each Durable Object call one of four shapes. Use these instead of calling a stub directly.

| Shape | Use for | On timeout |
|---|---|---|
| `rpc.query(op, call)` | Reads with no side effect | Asks once more, then throws `RpcTimeoutError` |
| `rpc.command(op, call)` | A change that must not run twice | Sent once; the error says it may still finish |
| `rpc.idempotentCommand(op, opId, call)` | A change the callee dedupes by `opId` | Resends with the same `opId`; the error carries it |
| `rpc.startJob(op, opId, start)` | Starting long work tracked by `opId` | Sent once; read the job by `opId` for the outcome |

machinectl calls carry an `opId` on every frame (`X-Machinectl-Op-Id` or `_meta.opId`, else a fresh one). The laptop daemon replays a known `opId` instead of running the tool again. `machinectl_call` takes an optional `opId` for retrying after a timeout.

`scripts/rpc-audit.mjs` checks these rules across `src/`. Calls that are safe without a wrapper are listed in `scripts/rpc-audit.allow.json`, each with a reason.

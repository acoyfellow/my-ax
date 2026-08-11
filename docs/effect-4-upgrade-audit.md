# Effect 3.x → 4.0 upgrade audit

Scope of Effect in this repo is small and shallow. The upgrade is low risk and
can be done in one bounded pass. This audit lists the exact surface, the known
4.0 breaking-change classes to check against it, and the concrete steps.

## Current footprint

- Pinned: `effect@3.21.3` (`package.json`).
- Importers: three files only.
  - `src/notify.ts` — web-push delivery with retry.
  - `src/oauth-store.ts` — token-endpoint fetch with retry.
  - `src/mcp-probe.ts` — MCP probe with retry/timeout.
- Symbols used: `Effect`, `Schedule`, `Duration`, `Data` (`Data.TaggedError`),
  and small `Schema` / `Stream` / `pipe` usage.
- Concrete patterns in use:
  - `Effect.gen`, `Effect.try`, `Effect.tryPromise`, `Effect.promise`,
    `Effect.timeout`, `Effect.retry`, `Effect.catchAll`, `Effect.succeed`,
    `Effect.orElseSucceed`, `Effect.forEach({ concurrency })`,
    `Effect.runPromise`.
  - `Schedule.exponential`, `Schedule.jittered`, `Schedule.recurs`,
    `Schedule.intersect`, `Schedule.whileInput`.
  - `Duration.millis`, `Duration.seconds`.
  - `Data.TaggedError("Name")<{ ... }>`.

No use of `Layer`, `Context`, `Runtime`, `Ref`, `Config`, `Match`, or
`Effect.Service`, so the largest 4.0 migration areas do not apply here.

## What to verify against 4.0 breaking changes

1. Package + module shape. Confirm 4.0 is still a single `effect` package with
   the same submodule import style (`import { Effect, Schedule } from "effect"`).
   If 4.0 splits or renames entrypoints, update the three import lines.
2. `Effect.gen` adapter. 3.x `Effect.gen(function* () { ... yield* ... })` is
   already the adapterless form, which is the direction 4.0 wants; verify the
   generator signature did not change and that `yield*` on an `Effect` still
   works without the old `(_)=>` adapter.
3. `Effect.tryPromise` / `Effect.try` option shape. Confirm the
   `{ try, catch }` object form is still accepted (vs a positional form).
4. `Effect.timeout` semantics. In some versions `timeout` returns an `Option`
   or fails with a `TimeoutException`. Verify the failure/`Option` behavior our
   `.pipe(Effect.timeout(...), Effect.retry(...))` chains rely on is unchanged,
   because the retry schedule downstream depends on it surfacing as a failure.
5. `Schedule` combinators. Confirm `intersect`, `jittered`, `recurs`,
   `exponential`, and `whileInput` keep the same names and argument order.
6. `Duration` constructors. Confirm `Duration.millis` / `Duration.seconds`
   are unchanged (these are stable, low risk).
7. `Data.TaggedError`. Confirm the `Data.TaggedError("Tag")<{...}>` class
   factory and the `_tag` discriminant are unchanged; our `catchAll` and
   `whileInput` branch on `instanceof PushNetworkError`.
8. `Effect.forEach` concurrency option. Confirm `{ concurrency: n }` is still
   the option name and that numeric concurrency is still accepted.
9. `runPromise`. Confirm `Effect.runPromise` signature is unchanged and still
   rejects on defect vs. returning an exit (we rely on a rejected promise being
   caught by the surrounding `try`/handler where present).

## Steps

1. Read the official Effect 4.0 release notes and migration guide; map each
   item above to a keep/change decision.
2. Bump `effect` to `^4.0` in `package.json`, then `npm install`.
3. `npm run typecheck`. The type system surfaces most renames and signature
   changes directly in the three importer files.
4. Fix any changed imports/signatures in `src/notify.ts`, `src/oauth-store.ts`,
   `src/mcp-probe.ts` only.
5. Run the targeted tests for those paths (notify, mcp probe, and any
   oauth/token tests) plus `npm run test`.
6. Manually exercise one retry path (e.g. force a transient push failure) to
   confirm the retry/timeout behavior is unchanged at runtime, since types
   alone do not prove the `timeout`-as-failure semantics in step 4 above.
7. Deploy through the employee wrapper and confirm the worker builds and a
   push/oauth path still works in production.

## Risk

Low. The dependency is used in three isolated helpers with retry/timeout and a
tagged error, no service/layer graph. The main runtime-behavior risk is the
`Effect.timeout` failure semantics (step 4); everything else is a
compile-time-visible rename at most.

# Effect v4 backend architecture

My AX is moving from isolated Effect 3 helpers to an Effect v4 backend architecture. This document is the rule for that migration. It covers the main Worker, the factory Workers, and active live proof programs. It does not require frontend, generated code, pure data transforms, or static evidence to use Effect.

## Version decision

The public Effect documentation currently labels v4 as a release candidate. npm publishes:

- stable: `effect@3.22.1`
- v4 release candidate: `effect@4.0.0-rc.112`

My AX will pin the exact reviewed v4 release-candidate version while the migration is in progress. An unreviewed floating `rc` or prerelease range is not acceptable. Updating the pin requires rerunning the complete Effect backend verification.

## Official guidance reviewed

- [Onboarding](https://effect.website/docs/v4/onboarding)
- [Creating Effects](https://effect.website/docs/v4/getting-started/creating-effects)
- [Running Effects](https://effect.website/docs/v4/getting-started/running-effects)
- [Expected Errors](https://effect.website/docs/v4/error-management/expected-errors)
- [Unexpected Errors](https://effect.website/docs/v4/error-management/unexpected-errors)
- [Retrying](https://effect.website/docs/v4/error-management/retrying)
- [Timing Out](https://effect.website/docs/v4/error-management/timing-out)
- [Managing Services](https://effect.website/docs/v4/requirements-management/services)
- [Managing Layers](https://effect.website/docs/v4/requirements-management/layers)
- [Basic Concurrency](https://effect.website/docs/v4/concurrency/basic-concurrency)
- [Resource Management](https://effect.website/docs/v4/resource-management/introduction)
- [Scope](https://effect.website/docs/v4/resource-management/scope)
- [Schema](https://effect.website/docs/v4/schema/getting-started)
- [Code Style](https://effect.website/docs/v4/code-style/guidelines)

## Backend classification

Every backend file must be assigned one of these classes before the migration is complete.

| Class | Meaning | Effect rule |
|---|---|---|
| Effect program | Business workflow with external work or meaningful failure, timing, concurrency, or cleanup semantics | Write the workflow as `Effect` values |
| Effect service | GitHub, model, database, Sandbox, Browser, Pantry, OAuth, MCP, Workflow, clock, or telemetry capability | Define with `Context.Service`; construct with `Layer` |
| Runtime adapter | Cloudflare `fetch`, scheduled, Workflow, Durable Object, or RPC entrypoint | Parse input, provide Layers, run one program, translate the exit |
| Pure TypeScript | Classification, formatting, policy, immutable data transforms, constants | Keep plain TypeScript |
| Frontend or generated | Svelte, browser-only helpers, styles, generated bundles and documentation | Do not migrate |
| Static evidence | Tests, fixtures, historical receipts, and documentation | Keep as evidence; only executable live workflows need Effect |
| Obsolete | Unused compatibility or retired product surface | Delete instead of migrating |

A filename or directory does not decide the class. Behavior does.

## Required design

### Services

External capabilities use `Context.Service`. Service operations return Effects whose requirements are `never`; construction dependencies belong in their Layers instead of leaking through service interfaces.

Live implementations use named `Layer` values. Tests provide small deterministic Layers. Business programs do not receive broad environment bags or Promise-based port objects.

### Errors

Expected failures use named `Data.TaggedError` values and remain in the typed error channel. Programs recover with `Effect.catchTag` or `Effect.catchTags` where the business rule explicitly permits recovery.

Invalid input, denied authorization, provider rejection, capacity, timeout, conflict, and unproven receipts are expected failures. Broken invariants and programmer errors are defects. Defects are not converted into friendly domain failures merely to make a handler return a response.

Runtime adapters may inspect the full exit or cause to map typed failures to HTTP or Workflow outcomes. They must keep defects distinguishable.

### Retries and timeouts

`Effect.retry` uses an explicit bounded `Schedule`. A source Effect runs once before the retry schedule applies. Retries are allowed only for operations proven safe to repeat:

- reads;
- writes with a stable idempotency key and verified provider semantics;
- operations whose service contract explicitly guarantees idempotency.

GitHub branch, comment, review, issue, pull-request, and deployment mutations are not retried by default.

`Effect.timeout` produces a typed `Cause.TimeoutError` in v4. Workflows may instead use `Effect.timeoutOption` or `Effect.timeoutOrElse` when absence or a domain-specific timeout is the intended contract. Timeout errors must not be accidentally fed into a schedule that only understands transport errors.

### Concurrency

Use structured concurrency. `Effect.all` and `Effect.forEach` are sequential unless an explicit concurrency value is supplied. Every parallel operation must have a reviewed bound. `"unbounded"` is forbidden in My AX backend code.

Races must state what happens to losers and preserve the existing factory quorum or receipt rules. Serial delegation remains serial when that is part of rate-limit or ordering safety.

### Resources and cleanup

Use `Effect.acquireUseRelease`, `Effect.ensuring`, `Effect.addFinalizer`, and `Effect.scoped` for resources with a lifetime. Cleanup runs for success, typed failure, defect, and interruption.

Cleanup must not hide the primary failure. Sandbox snapshots still complete before destructive recycle. Cloudflare Workflow durability, Durable Object state, and D1 transactions remain platform boundaries; an Effect Scope is not a replacement for durable execution.

### Validation

External JSON, webhook payloads, environment configuration, stored JSON, and model-produced structured output use Effect Schema where validation or transformation is meaningful. Internal constants and already typed pure values do not need ceremonial schemas.

### Runtime edges

`Effect.runPromise` or `Effect.runPromiseExit` appears only in runtime adapters and test runners. Helpers and services return Effects instead of starting nested runtimes. Each Cloudflare entrypoint runs one provided program.

## Migration order

1. Rebase this worktree on the completed cleanup so retired surfaces are not migrated.
2. Build the architecture inventory and enforcement test.
3. Migrate factory configuration, GitHub, Terrarium, model, and clock services.
4. Migrate factory triage, review, audit, sweep, and implementation workflows.
5. Convert active factory and deployment proof workflows; classify historical evidence and delete obsolete gates.
6. Migrate shared external clients: OAuth, Pantry, MCP, Browser, web search, gateway, and notifications.
7. Migrate Sandbox lifecycle, jobs, schedules, receipts, and database repositories.
8. Split the main agent runtime into services and migrate it last.
9. Run independent architecture and behavior review.

## Factory invariants

The rewrite must preserve these rules:

- The Worker never merges or approves.
- Children never receive GitHub credentials.
- An unverified Terrarium receipt cannot advance work.
- A factory seed is not a product change.
- An unresolved issue remains unresolved when a carrier PR or branch fails.
- External mutations are idempotent or single-attempt with explicit evidence.
- Cloudflare Workflow step boundaries remain durable boundaries.

## Verification contract

`npm run verify:effect-backend` must:

1. verify the inventory has no unclassified backend files;
2. run an architecture check for unmanaged backend effects;
3. run factory, proof, and affected product tests;
4. typecheck the reviewed Effect surface;
5. build the main Worker, factory Worker, and factory hook Worker with Wrangler dry runs;
6. verify public-source safety;
7. record bundle size so the migration cannot silently worsen the known isolate-memory risk.

The migration is incomplete until that command exists and passes from a clean checkout.

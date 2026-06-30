// Worker-only re-export of the canonical CodemodeRuntime Durable Object
// class and a runtime builder. Lives in its own module so unit tests can
// keep importing the in-process connector / snippet helpers from
// `./code-mode-runtime` without pulling `cloudflare:workers` into the
// Node test runner.
//
// Wired from the worker entry (src/index.tsx) as a Durable Object
// binding so the codemode runtime facet has a stable DO class name in
// wrangler.jsonc. `runNativeCodemode` is the opt-in native execution
// helper used by future work_code wiring; the in-process
// `createCodemodeWorkRuntime` path remains the default until the
// migration cuts work_code over to native execution.

import { createCodemodeRuntime } from "@cloudflare/codemode";
import type { CodemodeRuntimeHandle } from "@cloudflare/codemode";
import type { NativeCodemodeOptions } from "./code-mode-runtime";

export { CodemodeRuntime } from "@cloudflare/codemode";

export function runNativeCodemode(options: NativeCodemodeOptions): CodemodeRuntimeHandle {
  return createCodemodeRuntime({
    ctx: options.ctx,
    connectors: options.connectors,
    executor: options.executor,
    name: options.name ?? "my-ax",
    maxExecutions: options.maxExecutions ?? 50,
  });
}

export type { NativeCodemodeOptions } from "./code-mode-runtime";

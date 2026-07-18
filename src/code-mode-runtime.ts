// Codemode runtime adapter for My AX.
//
// This module wires the workspace / machine / terrarium / saved-snippet
// surfaces behind the @cloudflare/codemode runtime contract. There are
// three layers, kept deliberately separate:
//
//   1. Type re-exports of the canonical CodemodeRuntime + snippet types
//      so the rest of My AX never imports @cloudflare/codemode directly.
//      A future native cutover changes only this module's wiring.
//
//   2. An in-process `createCodemodeWorkRuntime` builder that returns the
//      codemode-namespace surface (`search` / `describe` / `run`) for
//      consumption inside work_code. It dispatches to the three native
//      providers and optionally to a snippet hook.
//
//   3. A `runNativeCodemode` helper (in `code-mode-runtime.worker.ts`)
//      that drives a real CodemodeRuntime facet via `createCodemodeRuntime`
//      for callers that have a DurableObjectState handle. Worker runtime
//      entry points use that file; Node-only unit tests use only the
//      in-process layer here. The shape mirrors the runtime's `tool()`
//      proxy so a future cutover can swap the implementation without
//      touching `work-tools.ts`.
//
// HONEST SCOPE NOTE: today's work_code path still routes through
// `DynamicWorkerExecutor` because the native CodemodeRuntime needs a
// DurableObjectState handle, and `executeWorkCode` runs on the agent's
// own DO (not inside a child CodemodeRuntime facet). No call site in
// this worker drives `runNativeCodemode` yet, so the `CodemodeRuntime`
// Durable Object binding and `v11-codemode-runtime` migration are
// intentionally HELD out of wrangler.jsonc (round 04 review) — wiring
// them in without a call site would mean shipping a forward-only DO
// migration for dead code. The `createCodemodeRuntime` builder remains
// re-exported from `code-mode-runtime.worker.ts` so the future cutover
// only needs to bind the DO and add the first call site at the same
// time. Until then, snippet provenance stays projected/synthetic — see
// `cm-snippets.ts` for the honest seam.

import type { CodemodeRuntimeHandle, CodemodeConnector, Executor } from "@cloudflare/codemode";

export const CODE_MODE_EXECUTION_TIMEOUT_MS = 60_000;

// Re-export the canonical runtime class so the rest of My AX never imports
// @cloudflare/codemode directly. The class itself extends `DurableObject`
// from `cloudflare:workers`, which is not loadable under Node-only test
// runners (tsx). To keep `code-mode-runtime` importable from unit tests,
// the class is re-exported from a sibling worker-only entrypoint
// (`code-mode-runtime.worker.ts`) while the type alias lives here for
// ambient typings.
export type { CodemodeRuntime } from "@cloudflare/codemode";
export type {
  CodemodeRuntimeHandle,
  CodemodeConnector,
  ConnectorDescription,
  Snippet,
  SaveSnippetOptions,
  ExecutionState,
  PendingAction,
} from "@cloudflare/codemode";

// Lightweight in-process descriptor of a codemode connector. The @cloudflare
// /codemode `CodemodeConnector` base class is a `WorkerEntrypoint` — useful
// when each connector is its own Worker, but heavy for the in-process
// workspace/machine/terrarium trio. We mirror only the public connector shape
// (describe + tools) so model code calling `codemode.search/describe/run`
// has the same surface, and so an eventual swap to the real connector base
// class is a structural refactor, not an API change.
export interface CodemodeWorkTool {
  name: string;
  description: string;
  inputSchema?: unknown;
  execute: (input: unknown) => Promise<unknown>;
}

export interface CodemodeWorkConnector {
  name: string;
  description: string;
  tools: CodemodeWorkTool[];
}

// The CodemodeSnippetHook is the migration-facing contract. The saved-recipes
// service today implements `list`/`run` over D1; the future codemode runtime
// will implement the same interface over the DO snippets table. work_code
// holds only the interface, so promoting saved_recipes to codemode snippets
// is a swap of the implementation, not the consumer.
export interface CodemodeSnippetHook {
  list: () => Promise<Array<{
    id: string;
    name: string;
    description: string;
    inputSchema: unknown;
    capabilities: string[];
    /**
     * Optional codemode execution id for receipts/audit. Synthetic for
     * transition data, real once a native run promotes the snippet. See
     * cm-snippets.ts.
     */
    codemodeExecutionId?: string;
    sourceRecipeId?: string | null;
    provenance?: "projected" | "native";
  }>>;
  run: (input: { id?: string; name?: string; input?: Record<string, unknown> }) => Promise<unknown>;
}

// One namespace bundled as a codemode connector: pair the catalog with its
// dispatcher so the runtime can serve `describe()` and execute calls without
// the consumer thinking about either side.
export interface CodemodeWorkSource {
  connector: CodemodeWorkConnector;
  fns: Record<string, (input: unknown) => Promise<unknown>>;
}

export interface CodemodeWorkRuntime {
  /** Connector descriptions, suitable for `codemode.search` results. */
  connectors: CodemodeWorkConnector[];
  /** The `codemode` namespace exposed inside work_code. */
  namespace: {
    search: (query?: string) => Promise<{
      query: string;
      matches: Array<{ connector: string; tool: string; description: string }>;
    }>;
    describe: (name: string) => Promise<{
      connector: string;
      tool: string;
      description: string;
      inputSchema?: unknown;
    } | null>;
    run: (name: string, input?: unknown) => Promise<unknown>;
  };
  /** Bridge functions exposed to the sandbox (one per `connector.tool`). */
  bridgeFns: Record<string, (input: unknown) => Promise<unknown>>;
  /** Prelude text that wires the `codemode` namespace inside the sandbox. */
  prelude: string;
}

function fullToolName(connector: string, tool: string) {
  return `${connector}.${tool}`;
}

function parseQualified(name: string): { connector: string; tool: string } | null {
  const idx = name.indexOf(".");
  if (idx <= 0 || idx === name.length - 1) return null;
  return { connector: name.slice(0, idx), tool: name.slice(idx + 1) };
}

/**
 * Build the in-process codemode-shaped runtime exposed to work_code.
 *
 * Accepts the three native namespaces (workspace/machine/terrarium) plus an
 * optional snippet hook backed by saved_recipes. Returns the `codemode`
 * namespace (search/describe/run), the per-tool bridge functions, and the
 * sandbox prelude that wires `globalThis.codemode` to those bridge calls.
 *
 * Returned namespace does NOT advertise a top-level `recipe.list` or
 * `recipe.run` — saved snippets are exposed through `codemode.run("name",
 * input)` only, so the work_code description / search results stop
 * carrying the legacy `recipe.*` surface.
 *
 * IMPORTANT: this is the in-process shape backed by the existing
 * DynamicWorkerExecutor path, not a CodemodeRuntime facet. Native
 * CodemodeRuntime instantiation lives in `runNativeCodemode` (in
 * `code-mode-runtime.worker.ts`); the worker entry imports it from there.
 */
export function createCodemodeWorkRuntime(
  sources: CodemodeWorkSource[],
  snippetHook?: CodemodeSnippetHook,
): CodemodeWorkRuntime {
  const connectors = sources.map((source) => source.connector);
  const dispatchers = new Map<string, (input: unknown) => Promise<unknown>>();
  const toolIndex = new Map<string, { connector: string; tool: CodemodeWorkTool }>();
  for (const source of sources) {
    for (const tool of source.connector.tools) {
      const fn = source.fns[tool.name];
      if (!fn) continue;
      dispatchers.set(fullToolName(source.connector.name, tool.name), fn);
      toolIndex.set(fullToolName(source.connector.name, tool.name), { connector: source.connector.name, tool });
    }
  }

  async function snippetTools(): Promise<CodemodeWorkTool[]> {
    if (!snippetHook) return [];
    const recipes = await snippetHook.list().catch(() => []);
    return recipes.map((recipe) => ({
      name: recipe.name,
      description: recipe.description,
      inputSchema: recipe.inputSchema,
      execute: async (input: unknown) => snippetHook.run({ name: recipe.name, input: input as Record<string, unknown> | undefined }),
    }));
  }

  const namespace: CodemodeWorkRuntime["namespace"] = {
    async search(query?: string) {
      const haystack: Array<{ connector: string; tool: string; description: string }> = [];
      for (const connector of connectors) {
        for (const tool of connector.tools) {
          haystack.push({ connector: connector.name, tool: tool.name, description: tool.description });
        }
      }
      for (const tool of await snippetTools()) {
        haystack.push({ connector: "snippet", tool: tool.name, description: tool.description });
      }
      const q = typeof query === "string" ? query.trim().toLowerCase() : "";
      const matches = q
        ? haystack.filter((entry) => `${entry.connector}.${entry.tool} ${entry.description}`.toLowerCase().includes(q))
        : haystack;
      return { query: q, matches };
    },
    async describe(name: string) {
      const qualified = parseQualified(name);
      if (qualified) {
        const entry = toolIndex.get(fullToolName(qualified.connector, qualified.tool));
        if (entry) return { connector: entry.connector, tool: entry.tool.name, description: entry.tool.description, inputSchema: entry.tool.inputSchema };
        if (qualified.connector === "snippet") {
          const tool = (await snippetTools()).find((t) => t.name === qualified.tool);
          if (tool) return { connector: "snippet", tool: tool.name, description: tool.description, inputSchema: tool.inputSchema };
        }
        return null;
      }
      const tool = (await snippetTools()).find((t) => t.name === name);
      if (!tool) return null;
      return { connector: "snippet", tool: tool.name, description: tool.description, inputSchema: tool.inputSchema };
    },
    async run(name: string, input?: unknown) {
      const qualified = parseQualified(name);
      if (qualified) {
        const fn = dispatchers.get(fullToolName(qualified.connector, qualified.tool));
        if (fn) return fn(input);
        if (qualified.connector === "snippet" && snippetHook) {
          return snippetHook.run({ name: qualified.tool, input: (input ?? {}) as Record<string, unknown> });
        }
        throw new Error(`codemode.run: unknown tool ${name}`);
      }
      if (!snippetHook) throw new Error(`codemode.run: unknown tool ${name}`);
      return snippetHook.run({ name, input: (input ?? {}) as Record<string, unknown> });
    },
  };

  // Bridge functions are keyed flat ("connector__tool") so the sandbox-side
  // prelude can call them through `bridge[...]` without parsing the dot.
  const bridgeFns: Record<string, (input: unknown) => Promise<unknown>> = {};
  for (const [qualified, fn] of dispatchers) {
    const { connector, tool } = parseQualified(qualified)!;
    bridgeFns[`codemode__${connector}__${tool}`] = fn;
  }
  bridgeFns["codemode__search"] = async (input) => namespace.search(typeof input === "string" ? input : ((input as { query?: string } | undefined)?.query));
  bridgeFns["codemode__describe"] = async (input) => namespace.describe(typeof input === "string" ? input : String((input as { name?: string } | undefined)?.name ?? ""));
  bridgeFns["codemode__run"] = async (input) => {
    const body = (input ?? {}) as { name?: string; input?: unknown };
    return namespace.run(String(body.name ?? ""), body.input);
  };

  const prelude = [
    "globalThis.codemode={",
    `search:(query)=>bridge["codemode__search"](query),`,
    `describe:(name)=>bridge["codemode__describe"](name),`,
    `run:(name,input)=>bridge["codemode__run"]({name,input}),`,
    "};",
  ].join("");

  return { connectors, namespace, bridgeFns, prelude };
}

/**
 * Options for `runNativeCodemode` (defined in
 * `code-mode-runtime.worker.ts`). The native execution path wires the
 * workspace/machine/terrarium connectors as `CodemodeConnector` workers
 * and uses `createCodemodeRuntime` to give callers the canonical
 * tool/approve/reject/rollback/snippet API. Used only from worker-
 * runtime entry points that have a DurableObjectState handle; unit
 * tests exercise the in-process runtime above.
 */
export type NativeCodemodeOptions = {
  ctx: DurableObjectState;
  connectors: CodemodeConnector[];
  executor: Executor;
  name?: string;
  maxExecutions?: number;
};

/**
 * The native runtime builder lives in `code-mode-runtime.worker.ts` so it
 * does not pull `cloudflare:workers` into the Node test runner. This is a
 * type-only signature for type clients that need it.
 */
export type RunNativeCodemode = (options: NativeCodemodeOptions) => CodemodeRuntimeHandle;

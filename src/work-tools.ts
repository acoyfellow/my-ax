import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { CODE_MODE_EXECUTION_TIMEOUT_MS, createCodemodeWorkRuntime, type CodemodeWorkSource, type CodemodeSnippetHook } from "./code-mode-runtime";
import { createMachineWorkProvider } from "./routes/machinectl";
import { resolveWorkCodeExecutionState } from "./computer-work-budget";
import { capWorkCodeCollection, capWorkCodeCollectionWithMetadata, capWorkCodeValue, instrumentWorkCodeFunctions, mergeWorkCodeLogs, raceWorkCodeExecution, WorkCodeLogMirror, WORK_CODE_TIMEOUT_GRACE_MS, WorkCodeCallCollector, WORK_CODE_CALLS_MAX_BYTES, WORK_CODE_CALLS_MAX_ENTRIES, WORK_CODE_LOGS_MAX_BYTES, WORK_CODE_LOGS_MAX_ENTRIES, WORK_CODE_RESULT_MAX_BYTES } from "./work-code-output";
import { isSandboxMutationWorkCodeCall } from "./workspace-snapshot-classification";
import type { ToolContext, ToolDef } from "./types";
import { suggestRecipeName, suggestRecipeDescription, isPortable } from "./suggest-recipe-name";
import { evaluateReusableToolCandidate, reusableToolNameFromMarker } from "./reusable-tool-candidate";
import { Effect } from "effect";
import { databaseLayer } from "./effect/database";
import { reusableToolApprovalMode } from "./reusable-tool-preferences-program";
import { coerceToolArguments } from "./tool-arguments";
import { CODEMODE_METHODS, FACTORY_PAGE_METHODS, PAGE_WORK_METHODS, WORK_CODE_DESCRIPTION, WORK_SEARCH_DESCRIPTION, WORKSPACE_METHODS } from "./work-tools-catalog";


export const SANDBOX_ONLY_WORK_CAPABILITIES = WORKSPACE_METHODS.map((method) => `workspace.${method.name}`);

// PAGE_VERBS. Each verb marshals over the chat WS to the live browser client.

type WorkCall = {
  index: number;
  where: "workspace" | "machine" | "codemode" | "page";
  method: string;
  status: "ok" | "error";
  durationMs: number;
  error?: string;
};

function workspaceProvider(ctx: ToolContext) {
  return {
    read: async (input: any) => ({ path: input?.path, content: await ctx.readFile(String(input?.path ?? "")) }),
    write: async (input: any) => {
      const path = String(input?.path ?? "");
      await ctx.writeFile(path, String(input?.content ?? ""));
      return { path, written: true, durable: true };
    },
    list: async (input: any) => ctx.listFiles(String(input?.path ?? ctx.workingDirectory), { recursive: Boolean(input?.recursive), includeHidden: Boolean(input?.includeHidden) }),
    search: async (input: any) => ctx.shellExec(`rg -n --glob '!.my-ax/conversations/**' --glob '!*.jsonl' -- ${JSON.stringify(String(input?.query ?? ""))} ${JSON.stringify(String(input?.path ?? ctx.workingDirectory))}`, { cwd: ctx.workingDirectory, timeout: Number(input?.timeoutMs ?? 30_000) }),
    exec: async (raw: any) => { const input = commandInput(raw); return ctx.shellExec(String(input?.command ?? ""), { cwd: input?.cwd === undefined ? ctx.workingDirectory : String(input.cwd), cwdExplicit: input?.cwd !== undefined, timeout: Number(input?.timeoutMs ?? 30_000) }) },
    process_start: async (raw: any) => { const input = commandInput(raw); return ctx.processStart(String(input?.command ?? ""), { cwd: input?.cwd === undefined ? ctx.workingDirectory : String(input.cwd), cwdExplicit: input?.cwd !== undefined }); },
    process_status: async (input: any) => ctx.processStatus(String(input?.processId ?? "")),
    process_logs: async (input: any) => ctx.processLogs(String(input?.processId ?? "")),
    process_cancel: async (input: any) => ({ cancelled: await ctx.processCancel(String(input?.processId ?? ""), input?.signal === undefined ? undefined : String(input.signal)) }),
    run_code: async (input: any) => ctx.runCode(String(input?.code ?? ""), { language: input?.language === "typescript" ? "typescript" : "javascript", timeout: Number(input?.timeoutMs ?? CODE_MODE_EXECUTION_TIMEOUT_MS) }),
    preview_open: async (input: any) => ctx.tunnelGet(Number(input?.port)),
    preview_list: async () => ctx.tunnelList(),
    observe: async (input: any) => ctx.observeTurns ? { turns: await ctx.observeTurns(String(input?.sessionId ?? ctx.sessionId), Number(input?.turns ?? 3)) } : { error: "observe is not available in this context" },
    preview_close: async (input: any) => { await ctx.tunnelDestroy(Number(input?.port)); return { closed: true, port: Number(input?.port) }; },
  };
}

const PLAIN_COMMAND_METHODS = new Set(["exec", "process_start"]);

export function normalizeWorkArguments(method: string, input: unknown): Record<string, unknown> {
  if (PLAIN_COMMAND_METHODS.has(method) && typeof input === "string" && !input.trim().startsWith("{")) {
    return { command: input };
  }
  return coerceToolArguments(input);
}

export function commandInput(raw: unknown): { command?: unknown; cwd?: unknown; timeoutMs?: unknown } | undefined {
  if (typeof raw === "string") return { command: raw };
  return raw as { command?: unknown; cwd?: unknown; timeoutMs?: unknown } | undefined;
}

function checkedWorkspaceProvider(ctx: ToolContext) {
  const fns = workspaceProvider(ctx);
  const missing = WORKSPACE_METHODS.filter((method) => !(method.name in fns));
  if (missing.length) throw new Error(`Workspace catalog/dispatcher drift: ${missing.map((method) => method.name).join(", ")}`);
  return fns;
}

function restrictByCapabilities(
  where: WorkCall["where"],
  fns: Record<string, (input: any) => Promise<unknown>>,
  allowedCapabilities?: string[],
) {
  if (allowedCapabilities === undefined) return fns;
  const allowed = new Set(allowedCapabilities);
  return Object.fromEntries(Object.entries(fns).map(([method, invoke]) => {
    const capability = `${where}.${method}`;
    return [method, allowed.has(capability) ? invoke : async () => {
      throw new Error(`capability not granted: ${capability}`);
    }];
  }));
}

function instrument(
  where: WorkCall["where"],
  fns: Record<string, (input: any) => Promise<unknown>>,
  calls: WorkCodeCallCollector<WorkCall["where"]>,
  normalizeArguments = true,
) {
  const functions = normalizeArguments
    ? Object.fromEntries(Object.entries(fns).map(([method, invoke]) => [
        method,
        (input: unknown) => invoke(normalizeWorkArguments(method, input)),
      ]))
    : fns;
  return instrumentWorkCodeFunctions(where, functions, calls, (method) => ({
    sandboxMutation: isSandboxMutationWorkCodeCall({ where, method }),
    codemodeInvoked: where === "codemode",
  }));
}

function catalogEntry(where: WorkCall["where"] | "codemode" | "snippet", name: string, description: string, available = true, inputSchema?: unknown) {
  return { method: `${where}.${name}`, where, description, available, ...(inputSchema ? { inputSchema } : {}) };
}



export const WORK_SEARCH_TOOL: ToolDef = {
  name: "work_search",
  description: WORK_SEARCH_DESCRIPTION,
  parameters: { type: "object", properties: { query: { type: "string", description: "What capability or kind of work is needed." } } },
  execute: async (args, ctx) => {
    checkedWorkspaceProvider(ctx);
    const sandboxOnly = ctx.sandboxOnly === true;
    const machine = sandboxOnly ? { catalog: [] as Array<{ name: string; description: string; inputSchema?: unknown }>, connected: false } : await createMachineWorkProvider(ctx);
    const snippets = ctx.listSavedRecipes ? await ctx.listSavedRecipes().catch(() => []) : [];
    const pageCatalog = sandboxOnly ? FACTORY_PAGE_METHODS : PAGE_WORK_METHODS;
    const catalog = [
      ...WORKSPACE_METHODS.map((method) => catalogEntry("workspace", method.name, method.description)),
      ...(sandboxOnly ? [] : machine.catalog.map((method) => catalogEntry("machine", method.name, method.description, machine.connected, method.inputSchema))),
      ...pageCatalog.map((method) => catalogEntry("page", method.name, method.description, Boolean(ctx.callPage))),
      ...CODEMODE_METHODS.map((method) => catalogEntry("codemode", method.name, method.description, true)),
      ...snippets.map((snippet) => ({ method: `codemode:${snippet.name}`, where: "codemode" as const, description: snippet.description, available: true, inputSchema: snippet.inputSchema, capabilities: snippet.capabilities })),
    ];
    const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
    const filtered = query ? catalog.filter((entry) => `${entry.method} ${entry.description} ${entry.where}`.toLowerCase().includes(query)) : catalog;
    return JSON.stringify({ ok: true, places: { workspace: "My AX Workspace (persistent Sandbox files, shell, processes, and previews)", ...(sandboxOnly ? {} : { machine: "My Machine", page: "My AX Page (live browser UI)" }) }, matches: filtered.length ? filtered : catalog });
  },
};

function buildSnippetHook(ctx: ToolContext): CodemodeSnippetHook | undefined {
  if (ctx.exposeSavedRecipes === false) return undefined;
  if (!ctx.listSavedRecipes || !ctx.runSavedRecipe) return undefined;
  return {
    list: () => ctx.listSavedRecipes!(),
    // Capability intersection: snippet runs inherit the caller's bounds
    // so a snippet cannot widen what work_code was already allowed to
    // do. When the caller is unrestricted (typical top-level turn),
    // callerCapabilities is undefined and the snippet's declared
    // capabilities apply unchanged.
    run: (input) => ctx.runSavedRecipe!({
      id: typeof input?.id === "string" ? input.id : undefined,
      name: typeof input?.name === "string" ? input.name : undefined,
      input: input.input ?? {},
      callerCapabilities: ctx.allowedWorkCapabilities,
      workCodeExecutionState: ctx.workCodeExecutionState,
    }),
  };
}

export async function executeWorkCode(code: string, ctx: ToolContext) {
  if (!code || new TextEncoder().encode(code).byteLength > 32_000) return { ok: false, error: "code is required and must be <= 32000 bytes" };
  const executionState = resolveWorkCodeExecutionState(ctx.workCodeExecutionState);
  const sandboxOnly = ctx.sandboxOnly === true;
  const executionContext = {
    ...ctx,
    workCodeExecutionState: executionState,
    allowedWorkCapabilities: sandboxOnly
      ? [...SANDBOX_ONLY_WORK_CAPABILITIES, ...FACTORY_PAGE_METHODS.map((method) => `page.${method.name}`)]
      : ctx.allowedWorkCapabilities,
    callPage: ctx.callPage,
  };
  const machine = sandboxOnly ? { catalog: [] as Awaited<ReturnType<typeof createMachineWorkProvider>>["catalog"], fns: {} as Record<string, (input: any) => Promise<unknown>>, connected: false } : await createMachineWorkProvider(executionContext);
  const calls = new WorkCodeCallCollector<WorkCall["where"]>();
  const workspaceFns = instrument("workspace", restrictByCapabilities("workspace", checkedWorkspaceProvider(executionContext), executionContext.allowedWorkCapabilities), calls);
  const machineFns = instrument("machine", restrictByCapabilities("machine", machine.fns, executionContext.allowedWorkCapabilities), calls);
  const pageMethods = sandboxOnly ? FACTORY_PAGE_METHODS : PAGE_WORK_METHODS;
  const pageFns = executionContext.callPage
    ? instrument("page", restrictByCapabilities("page", Object.fromEntries(pageMethods.map((m) => [
        m.name,
        async (input: unknown) => executionContext.callPage!(m.name, (input ?? {}) as Record<string, unknown>),
      ])), executionContext.allowedWorkCapabilities), calls)
    : {};

  // Native codemode connector trio. Wrapping the same instrumented dispatchers
  // keeps a single receipt/cost path for both call styles.
  const codemodeSources: CodemodeWorkSource[] = [
    {
      connector: { name: "workspace", description: "My AX Workspace — canonical Sandbox-backed storage, shell, processes, and previews.", tools: WORKSPACE_METHODS.map((method) => ({ name: method.name, description: method.description, execute: workspaceFns[method.name] })) },
      fns: workspaceFns,
    },
    ...(!sandboxOnly ? [{
      connector: { name: "machine", description: "My Machine — the connected physical computer with local/authenticated state.", tools: machine.catalog.map((method) => ({ name: method.name, description: method.description, inputSchema: method.inputSchema, execute: machineFns[method.name] ?? (async () => { throw new Error(`machine method ${method.name} not available`); }) })) },
      fns: machineFns,
    }] : []),
    ...(executionContext.callPage ? [{
      connector: {
        name: "page",
        description: "My AX Page — the owner's LIVE browser UI for this conversation. Curated, capability-scoped verbs that drive the running app (read sessions/health/transcript, switch conversation, open panels). Only works while the owner has this conversation open in a browser; otherwise each verb errors page_unavailable.",
        tools: pageMethods.map((method) => ({ name: method.name, description: method.description, execute: pageFns[method.name] })),
      },
      fns: pageFns,
    }] : []),
  ];
  const snippetHook = buildSnippetHook(executionContext);
  const codemodeRuntime = createCodemodeWorkRuntime(codemodeSources, snippetHook);
  // Instrument the codemode entry points (search/describe/run) so their use
  // shows up in receipts and cost accounting alongside the underlying call.
  const instrumentedCodemodeBridge = instrument("codemode", {
    search: codemodeRuntime.bridgeFns["codemode__search"],
    describe: codemodeRuntime.bridgeFns["codemode__describe"],
    run: codemodeRuntime.bridgeFns["codemode__run"],
  }, calls, false);

  const logMirror = new WorkCodeLogMirror();
  const bridgeFns = {
    ...Object.fromEntries(Object.entries(workspaceFns).map(([name, fn]) => [`workspace_${name}`, fn])),
    ...Object.fromEntries(Object.entries(machineFns).map(([name, fn]) => [`machine_${name}`, fn])),
    ...Object.fromEntries(Object.entries(pageFns).map(([name, fn]) => [`page_${name}`, fn])),
    codemode__search: instrumentedCodemodeBridge.search,
    codemode__describe: instrumentedCodemodeBridge.describe,
    codemode__run: instrumentedCodemodeBridge.run,
    work_code_log: logMirror.record,
  };
  const namespace = (name: string, methods: string[]) =>
    `globalThis.${name}={${methods.map((method) => `${JSON.stringify(method)}:(args)=>bridge[${JSON.stringify(`${name}_${method}`)}](args)`).join(",")}};`;
  const pagePrelude = executionContext.callPage ? namespace("page", Object.keys(pageFns)) : "globalThis.page=undefined;";
  const prelude = [
    WorkCodeLogMirror.prelude("bridge", "work_code_log"),
    namespace("workspace", Object.keys(workspaceFns)),
    sandboxOnly ? "globalThis.machine=undefined;" : namespace("machine", Object.keys(machineFns)),
    pagePrelude,
    codemodeRuntime.prelude,
    `globalThis.ctx={workspace:globalThis.workspace,machine:globalThis.machine,page:globalThis.page,codemode:globalThis.codemode};`,
  ].join("\n");
  const submittedCode = code.trim().replace(/;+$/, "");
  const executableCode = `async () => await (${submittedCode})(globalThis.ctx)`;
  const executor = new DynamicWorkerExecutor({ loader: ctx.env.LOADER, globalOutbound: null, timeout: CODE_MODE_EXECUTION_TIMEOUT_MS });
  const execution = await raceWorkCodeExecution(
    executor.execute(executableCode, [{ name: "bridge", fns: bridgeFns, prelude }]),
    CODE_MODE_EXECUTION_TIMEOUT_MS + WORK_CODE_TIMEOUT_GRACE_MS,
  );
  const serializedCalls = capWorkCodeCollectionWithMetadata(calls.calls, WORK_CODE_CALLS_MAX_ENTRIES, WORK_CODE_CALLS_MAX_BYTES);
  const serializedLogs = capWorkCodeCollection([...mergeWorkCodeLogs(execution.logs, logMirror.logs)], WORK_CODE_LOGS_MAX_ENTRIES, WORK_CODE_LOGS_MAX_BYTES);
  const serializedResult = capWorkCodeValue(execution.result, WORK_CODE_RESULT_MAX_BYTES);
  const serializedError = execution.error === undefined ? undefined : capWorkCodeValue(execution.error, 1024);
  const inferredCapabilities = calls.inferredCapabilities;
  // Portability signal: portable when it needs no host namespace — its logic
  // runs in any harness. Surfaced so the owner can tell shelf-worthy (portable)
  // snippets from machine-bound ones without reading the code. (recipe audit)
  const portable = !calls.inferredCapabilitiesTruncated && isPortable(inferredCapabilities);
  // Marker-driven promotion candidacy. suggestedRecipe stays on the response
  // shape for backward compatibility (existing callers/tests still receive
  // it verbatim), but the actual promotion gate in agent.ts now keys off
  // reusableToolCandidate.eligible — which requires the model to add an
  // explicit `// reusable-tool: <name>` marker on broadly reusable code only.
  // A marker-derived name wins over the heuristic guess so `disk health check`
  // becomes `disk_health_check` in the shelf, not `snippet_<hash>`.
  const suggestedRecipe = {
    description: suggestRecipeDescription(code, inferredCapabilities),
    inputSchema: { type: "object", properties: {} },
    name: reusableToolNameFromMarker(code, suggestRecipeName(code)),
    code,
    capabilities: inferredCapabilities,
    portable,
  };
  const reusableToolCandidate = evaluateReusableToolCandidate({
    executionSucceeded: !execution.error && !calls.inferredCapabilitiesTruncated,
    sourceCode: code,
    inferredCapabilities,
    suggestedRecipe,
  });
  const reusableToolApprovalModeValue = await Effect.runPromise(
    reusableToolApprovalMode(ctx.identity.email, "review").pipe(Effect.provide(databaseLayer(ctx.env.DB))),
  );
  return {
    ok: !execution.error,
    result: serializedResult,
    ...(execution.error ? { error: serializedError } : {}),
    ...(execution.timedOut ? { timedOut: true, partial: true } : {}),
    logs: serializedLogs,
    calls: serializedCalls.values,
    callsTruncated: calls.callsTruncated || serializedCalls.truncated,
    sandboxMutation: calls.sandboxMutation,
    codemodeInvoked: calls.codemodeInvoked,
    sourceCode: code,
    inferredCapabilities,
    inferredCapabilitiesTruncated: calls.inferredCapabilitiesTruncated,
    portable,
    suggestedRecipe,
    reusableToolCandidate,
    reusableToolApprovalMode: reusableToolApprovalModeValue,
  };
}

export const WORK_CODE_TOOL: ToolDef = {
  name: "work_code",
  description: WORK_CODE_DESCRIPTION,
  parameters: { type: "object", properties: { code: { type: "string", description: "Async arrow function using workspace, machine, page, and/or codemode namespaces." } }, required: ["code"] },
  execute: async (args, ctx) => JSON.stringify(await executeWorkCode(typeof args.code === "string" ? args.code : "", ctx)),
};

import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { createTerrariumWorkProvider, TERRARIUM_WORK_METHODS } from "./terrarium-tools";
import { CODE_MODE_EXECUTION_TIMEOUT_MS, createCodemodeWorkRuntime, type CodemodeWorkSource, type CodemodeSnippetHook } from "./code-mode-runtime";
import { createMachineWorkProvider } from "./routes/machinectl";
import { COMPUTER_WORK_METHODS, createComputerWorkProvider } from "./computer-workspace";
import { applyComputerWorkBudget, resolveWorkCodeExecutionState } from "./computer-work-budget";
import { capWorkCodeCollection, capWorkCodeCollectionWithMetadata, capWorkCodeValue, instrumentWorkCodeFunctions, WorkCodeCallCollector, WORK_CODE_CALLS_MAX_BYTES, WORK_CODE_CALLS_MAX_ENTRIES, WORK_CODE_LOGS_MAX_BYTES, WORK_CODE_LOGS_MAX_ENTRIES, WORK_CODE_RESULT_MAX_BYTES } from "./work-code-output";
import { isSandboxMutationWorkCodeCall } from "./workspace-snapshot-classification";
import type { ToolContext, ToolDef } from "./types";
import { suggestRecipeName, suggestRecipeDescription, isPortable } from "./suggest-recipe-name";
import { evaluateReusableToolCandidate, reusableToolNameFromMarker } from "./reusable-tool-candidate";
import { reusableToolApprovalMode as resolveReusableToolApprovalMode } from "./reusable-tool-preferences";
import { coerceToolArguments } from "./tool-arguments";

const WORKSPACE_METHODS = [
  { name: "read", description: "Read a persistent file in the My AX Workspace." },
  { name: "write", description: "Write a persistent file in the My AX Workspace." },
  { name: "list", description: "List files in the My AX Workspace." },
  { name: "search", description: "Search workspace files with ripgrep." },
  { name: "exec", description: "Execute one bounded command in the My AX Workspace." },
  { name: "process_start", description: "Start a long-running workspace process." },
  { name: "process_status", description: "Inspect a workspace process." },
  { name: "process_logs", description: "Read workspace process logs." },
  { name: "process_cancel", description: "Cancel a workspace process." },
  { name: "run_code", description: "Run bounded JavaScript or TypeScript in the workspace interpreter." },
  { name: "preview_open", description: "Expose a workspace HTTP service through a temporary preview." },
  { name: "preview_list", description: "List active workspace previews." },
  { name: "preview_close", description: "Close a workspace preview." },
] as const;

// PAGE_VERBS. Each verb marshals over the chat WS to the live browser client.
const PAGE_WORK_METHODS = [
  { name: "listSessions", description: "List the owner's recent conversations: [{id,title,status,updatedAt}]. Optional {limit}." },
  { name: "readHealth", description: "Read workspace container health for the live session: {diskPct,files,version,region,...}." },
  { name: "readTranscriptTail", description: "Read the last N entries of the active conversation as rendered: [{role,text,ts}]. Optional {n}." },
  { name: "readViewport", description: "Read the live top-document viewport + .app-viewport frame gap: {innerWidth,innerHeight,visualHeight,visualScale,dvh,safeAreaTop,safeAreaBottom,appViewportRect,gapBelow,devicePixelRatio,userAgent,platform,uaMobile,maxTouchPoints,standalone}. Read-only." },
  { name: "setViewportDebug", description: "Toggle the on-screen viewport debug overlay in the owner's live UI (works in the installed iOS PWA where a URL query cannot). Input: {on}. Returns current viewport metrics {innerHeight,visualHeight,dvh,safeAreaBottom,appViewportBottom,gapBelow,standalone}." },
  { name: "switchSession", description: "Switch the active conversation in the owner's UI to {id}. Resolves on the client switch ack." },
  { name: "openSettings", description: "Open the settings dialog in the owner's UI, optionally to {section}." },
  { name: "openAttention", description: "Open the notifications/attention panel in the owner's UI." },
  { name: "openSessions", description: "Open the conversations sidebar in the owner's UI." },
  { name: "notify", description: "Show a transient in-app toast to the owner in the live UI. Input: {text, kind?}." },
  { name: "navigate", description: "Navigate the owner's UI to an in-app deep link (/?session=<id>, /?action=attention|settings, /runs/<id>). Input: {target}." },
  { name: "listArtifactTools", description: "List tools that live artifact widgets have self-registered: [{artifactId,name,description}]. Discover them here, then call invokeArtifactTool." },
  { name: "invokeArtifactTool", description: "Invoke a tool a live artifact widget self-registered (agent-drivable UI). Input: {artifactId, name, args?}. Parent-mediated + arg-validated." },
] as const;

type WorkCall = {
  index: number;
  where: "workspace" | "computer" | "machine" | "terrarium" | "codemode" | "page";
  method: string;
  status: "ok" | "error";
  durationMs: number;
  error?: string;
};

function workspaceProvider(ctx: ToolContext) {
  return {
    read: async (input: any) => ({ path: input?.path, content: await ctx.readFile(String(input?.path ?? "")) }),
    write: async (input: any) => { await ctx.writeFile(String(input?.path ?? ""), String(input?.content ?? "")); return { path: input?.path, written: true }; },
    list: async (input: any) => ctx.listFiles(String(input?.path ?? ctx.workingDirectory), { recursive: Boolean(input?.recursive), includeHidden: Boolean(input?.includeHidden) }),
    search: async (input: any) => ctx.shellExec(`rg -n -- ${JSON.stringify(String(input?.query ?? ""))} ${JSON.stringify(String(input?.path ?? ctx.workingDirectory))}`, { cwd: ctx.workingDirectory, timeout: Number(input?.timeoutMs ?? 30_000) }),
    exec: async (input: any) => ctx.shellExec(String(input?.command ?? ""), { cwd: input?.cwd === undefined ? ctx.workingDirectory : String(input.cwd), cwdExplicit: input?.cwd !== undefined, timeout: Number(input?.timeoutMs ?? 30_000) }),
    process_start: async (input: any) => ctx.processStart(String(input?.command ?? ""), { cwd: input?.cwd === undefined ? ctx.workingDirectory : String(input.cwd), cwdExplicit: input?.cwd !== undefined }),
    process_status: async (input: any) => ctx.processStatus(String(input?.processId ?? "")),
    process_logs: async (input: any) => ctx.processLogs(String(input?.processId ?? "")),
    process_cancel: async (input: any) => ({ cancelled: await ctx.processCancel(String(input?.processId ?? ""), input?.signal === undefined ? undefined : String(input.signal)) }),
    run_code: async (input: any) => ctx.runCode(String(input?.code ?? ""), { language: input?.language === "typescript" ? "typescript" : "javascript", timeout: Number(input?.timeoutMs ?? CODE_MODE_EXECUTION_TIMEOUT_MS) }),
    preview_open: async (input: any) => ctx.tunnelGet(Number(input?.port)),
    preview_list: async () => ctx.tunnelList(),
    preview_close: async (input: any) => { await ctx.tunnelDestroy(Number(input?.port)); return { closed: true, port: Number(input?.port) }; },
  };
}

function checkedWorkspaceProvider(ctx: ToolContext) {
  const fns = workspaceProvider(ctx);
  const missing = WORKSPACE_METHODS.filter((method) => !(method.name in fns));
  if (missing.length) throw new Error(`Workspace catalog/dispatcher drift: ${missing.map((method) => method.name).join(", ")}`);
  return fns;
}

function checkedComputerProvider(ctx: ToolContext) {
  const fns = createComputerWorkProvider(ctx).fns;
  const missing = COMPUTER_WORK_METHODS.filter((method) => !(method.name in fns));
  if (missing.length) throw new Error(`Computer catalog/dispatcher drift: ${missing.map((method) => method.name).join(", ")}`);
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
        (input: unknown) => invoke(coerceToolArguments(input)),
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

// Static codemode connector advertisement. The runtime itself is reachable
// inside work_code as `codemode.search()` / `codemode.describe(name)` /
// `codemode.run(name, input)` and dispatches to whichever underlying
// connector (workspace / machine / terrarium) or snippet owns the tool.
const CODEMODE_METHODS = [
  { name: "search", description: "List or filter codemode tools across Workspace, Computer, My Machine, Terrarium, My AX Page, and reusable tools." },
  { name: "describe", description: "Return the description and input schema for one codemode tool by qualified name." },
  { name: "run", description: "Invoke one codemode tool or owner-approved reusable tool by name with a structured input." },
] as const;

export const WORK_SEARCH_TOOL: ToolDef = {
  name: "work_search",
  description: "Discover where My AX can do work. My AX Workspace is the canonical persistent Sandbox path for shell commands, processes, and previews. Computer is a separate preview SQLite filesystem with bounded file-only methods and no execution backend; it does not replace or copy My AX Workspace, and there is no automatic sync. My Machine is the connected physical computer with local/authenticated state; Terrarium spawns bounded cloud agent runs with verified receipts. Search before choosing when the destination is not obvious.",
  parameters: { type: "object", properties: { query: { type: "string", description: "What capability or kind of work is needed." } } },
  execute: async (args, ctx) => {
    checkedWorkspaceProvider(ctx);
    checkedComputerProvider(ctx);
    const machine = await createMachineWorkProvider(ctx);
    const snippets = ctx.listSavedRecipes ? await ctx.listSavedRecipes().catch(() => []) : [];
    const catalog = [
      ...WORKSPACE_METHODS.map((method) => catalogEntry("workspace", method.name, method.description)),
      ...COMPUTER_WORK_METHODS.map((method) => catalogEntry("computer", method.name, method.description)),
      ...machine.catalog.map((method) => catalogEntry("machine", method.name, method.description, machine.connected, method.inputSchema)),
      ...TERRARIUM_WORK_METHODS.map((method) => catalogEntry("terrarium", method.name, method.description, Boolean(ctx.env.TERRARIUM_URL && ctx.env.TERRARIUM_CONTROL_TOKEN))),
      ...PAGE_WORK_METHODS.map((method) => catalogEntry("page", method.name, method.description, Boolean(ctx.callPage))),
      ...CODEMODE_METHODS.map((method) => catalogEntry("codemode", method.name, method.description, true)),
      ...snippets.map((snippet) => ({ method: `codemode:${snippet.name}`, where: "codemode" as const, description: snippet.description, available: true, inputSchema: snippet.inputSchema, capabilities: snippet.capabilities })),
    ];
    const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
    const filtered = query ? catalog.filter((entry) => `${entry.method} ${entry.description} ${entry.where}`.toLowerCase().includes(query)) : catalog;
    return JSON.stringify({ ok: true, places: { workspace: "My AX Workspace (Sandbox shell/process/preview)", computer: "Computer (preview SQLite filesystem, file-only)", machine: "My Machine", terrarium: "Terrarium (bounded cloud agent runs)", page: "My AX Page (live browser UI)" }, matches: filtered.length ? filtered : catalog });
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
  const executionContext = { ...ctx, workCodeExecutionState: executionState };
  const machine = await createMachineWorkProvider(ctx);
  const terrariumProvider = createTerrariumWorkProvider(ctx);
  const calls = new WorkCodeCallCollector<WorkCall["where"]>();
  // Build the workspace/machine/terrarium dispatchers up-front, then route them
  // through both the legacy raw bridge namespaces AND the new codemode runtime
  // so model code can call `workspace.read({...})` directly or hop through
  // `codemode.run("workspace.read", {...})` / `codemode.search()`.
  const workspaceFns = instrument("workspace", restrictByCapabilities("workspace", checkedWorkspaceProvider(ctx), ctx.allowedWorkCapabilities), calls);
  const computerFns = instrument("computer", restrictByCapabilities("computer", applyComputerWorkBudget(checkedComputerProvider(ctx), executionState), ctx.allowedWorkCapabilities), calls);
  const machineFns = instrument("machine", restrictByCapabilities("machine", machine.fns, ctx.allowedWorkCapabilities), calls);
  const terrariumFns = instrument("terrarium", restrictByCapabilities("terrarium", terrariumProvider.fns, ctx.allowedWorkCapabilities), calls);
  // page.* connector: each verb marshals to the live browser client via
  // ctx.callPage (over the chat WS). Only present when a live chat connection
  const pageFns = ctx.callPage
    ? instrument("page", restrictByCapabilities("page", Object.fromEntries(PAGE_WORK_METHODS.map((m) => [
        m.name,
        async (input: unknown) => ctx.callPage!(m.name, (input ?? {}) as Record<string, unknown>),
      ])), ctx.allowedWorkCapabilities), calls)
    : {};

  // Native codemode connector trio. Wrapping the same instrumented dispatchers
  // keeps a single receipt/cost path for both call styles.
  const codemodeSources: CodemodeWorkSource[] = [
    {
      connector: { name: "workspace", description: "My AX Workspace — canonical Sandbox-backed storage, shell, processes, and previews.", tools: WORKSPACE_METHODS.map((method) => ({ name: method.name, description: method.description, execute: workspaceFns[method.name] })) },
      fns: workspaceFns,
    },
    {
      connector: { name: "computer", description: "Computer preview — separate owner-scoped SQLite filesystem with bounded file methods only; no shell, processes, previews, or Sandbox data copy.", tools: COMPUTER_WORK_METHODS.map((method) => ({ name: method.name, description: method.description, execute: computerFns[method.name] })) },
      fns: computerFns,
    },
    {
      connector: { name: "machine", description: "My Machine — the connected physical computer with local/authenticated state.", tools: machine.catalog.map((method) => ({ name: method.name, description: method.description, inputSchema: method.inputSchema, execute: machineFns[method.name] ?? (async () => { throw new Error(`machine method ${method.name} not available`); }) })) },
      fns: machineFns,
    },
    {
      connector: { name: "terrarium", description: "Terrarium — spawn bounded cloud agent runs with verified receipts.", tools: TERRARIUM_WORK_METHODS.map((method) => ({ name: method.name, description: method.description, execute: terrariumFns[method.name] })) },
      fns: terrariumFns,
    },
    ...(ctx.callPage ? [{
      connector: {
        name: "page",
        description: "My AX Page — the owner's LIVE browser UI for this conversation. Curated, capability-scoped verbs that drive the running app (read sessions/health/transcript, switch conversation, open panels). Only works while the owner has this conversation open in a browser; otherwise each verb errors page_unavailable.",
        tools: PAGE_WORK_METHODS.map((method) => ({ name: method.name, description: method.description, execute: pageFns[method.name] })),
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

  const bridgeFns = {
    ...Object.fromEntries(Object.entries(workspaceFns).map(([name, fn]) => [`workspace_${name}`, fn])),
    ...Object.fromEntries(Object.entries(computerFns).map(([name, fn]) => [`computer_${name}`, fn])),
    ...Object.fromEntries(Object.entries(machineFns).map(([name, fn]) => [`machine_${name}`, fn])),
    ...Object.fromEntries(Object.entries(terrariumFns).map(([name, fn]) => [`terrarium_${name}`, fn])),
    ...Object.fromEntries(Object.entries(pageFns).map(([name, fn]) => [`page_${name}`, fn])),
    codemode__search: instrumentedCodemodeBridge.search,
    codemode__describe: instrumentedCodemodeBridge.describe,
    codemode__run: instrumentedCodemodeBridge.run,
  };
  const namespace = (name: string, methods: string[]) =>
    `globalThis.${name}={${methods.map((method) => `${JSON.stringify(method)}:(args)=>bridge[${JSON.stringify(`${name}_${method}`)}](args)`).join(",")}};`;
  const pagePrelude = ctx.callPage ? namespace("page", Object.keys(pageFns)) : "globalThis.page=undefined;";
  const prelude = [
    namespace("workspace", Object.keys(workspaceFns)),
    namespace("computer", Object.keys(computerFns)),
    namespace("machine", Object.keys(machineFns)),
    namespace("terrarium", Object.keys(terrariumFns)),
    pagePrelude,
    codemodeRuntime.prelude,
    "globalThis.ctx={workspace:globalThis.workspace,computer:globalThis.computer,machine:globalThis.machine,terrarium:globalThis.terrarium,page:globalThis.page,codemode:globalThis.codemode};",
  ].join("\n");
  const submittedCode = code.trim().replace(/;+$/, "");
  const executableCode = `async () => await (${submittedCode})(globalThis.ctx)`;
  const executor = new DynamicWorkerExecutor({ loader: ctx.env.LOADER, globalOutbound: null, timeout: CODE_MODE_EXECUTION_TIMEOUT_MS });
  const execution = await executor.execute(executableCode, [{ name: "bridge", fns: bridgeFns, prelude }]);
  const serializedCalls = capWorkCodeCollectionWithMetadata(calls.calls, WORK_CODE_CALLS_MAX_ENTRIES, WORK_CODE_CALLS_MAX_BYTES);
  const serializedLogs = capWorkCodeCollection(execution.logs ?? [], WORK_CODE_LOGS_MAX_ENTRIES, WORK_CODE_LOGS_MAX_BYTES);
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
  const reusableToolApprovalMode = await resolveReusableToolApprovalMode(ctx.env, ctx.identity.email);
  return {
    ok: !execution.error,
    result: serializedResult,
    ...(execution.error ? { error: serializedError } : {}),
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
    reusableToolApprovalMode,
  };
}

export const WORK_CODE_TOOL: ToolDef = {
  name: "work_code",
  description: "Execute one bounded JavaScript async function across the right place for the job. Code must be an async arrow function. The function receives ctx with {workspace,computer,machine,terrarium,page,codemode}; the same namespaces are also globals. My AX Workspace is the canonical Sandbox-backed path for workspace.read/write/list/search, shell commands, processes, code, and previews. Computer is a separate preview owner-scoped SQLite filesystem with computer.read({path}), computer.write({path,content}), computer.list({path}), and computer.grep({query,path,ignoreCase}); all Computer paths stay under /home/user, it has no execution backend, it does not replace My AX Workspace, no data is copied between them, and there is no automatic sync. My Machine methods come from work_search with their inputSchema. Terrarium methods spawn bounded cloud agent runs with verified receipts. My AX Page methods drive the owner's LIVE browser UI for this conversation while a tab is open. A codemode-shaped namespace is also reachable as codemode.search(query), codemode.describe(name), and codemode.run(name, input) to discover and invoke tools or owner-approved reusable tools. For multi-step, recurring, stateful, or easy-to-half-complete operational work, search codemode first and run a strong reusable-tool match by default instead of rebuilding the procedure; do not force weak matches for trivial work. Reusable-tool runs are bounded to the caller's capabilities, create receipts that carry the codemode execution id, and appear in Check-in. Reusable-tool candidates: if — and only if — the code is broadly reusable across future tasks, add exactly one leading comment `// reusable-tool: <short meaningful name>` on the first line. The owner chooses in Settings → Reusable tools whether qualifying tools wait for review or are enabled automatically. Never add the marker to one-off commands or ad-hoc scripts. No raw network, credentials, environment, or publication authority is exposed.",
  parameters: { type: "object", properties: { code: { type: "string", description: "Async arrow function using workspace, computer, machine, terrarium, page, and/or codemode namespaces." } }, required: ["code"] },
  execute: async (args, ctx) => JSON.stringify(await executeWorkCode(typeof args.code === "string" ? args.code : "", ctx)),
};

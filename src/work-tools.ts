import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { createCloudboxWorkProvider, CLOUDBOX_WORK_METHODS } from "./cloudbox-tools";
import { CODE_MODE_EXECUTION_TIMEOUT_MS, createCodemodeWorkRuntime, type CodemodeWorkSource, type CodemodeSnippetHook } from "./code-mode-runtime";
import { createMachineWorkProvider } from "./routes/machinectl";
import type { ToolContext, ToolDef } from "./types";
import { suggestRecipeName, suggestRecipeDescription, isPortable } from "./suggest-recipe-name";

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

type WorkCall = {
  index: number;
  where: "workspace" | "machine" | "cloudbox" | "codemode";
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
  calls: WorkCall[],
) {
  return Object.fromEntries(Object.entries(fns).map(([method, invoke]) => [method, async (input: unknown) => {
    const index = calls.length;
    const started = Date.now();
    try {
      const result = await invoke(input);
      calls.push({ index, where, method, status: "ok", durationMs: Date.now() - started });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      calls.push({ index, where, method, status: "error", durationMs: Date.now() - started, error: message.slice(0, 300) });
      throw error;
    }
  }]));
}

function catalogEntry(where: WorkCall["where"] | "codemode" | "snippet", name: string, description: string, available = true, inputSchema?: unknown) {
  return { method: `${where}.${name}`, where, description, available, ...(inputSchema ? { inputSchema } : {}) };
}

// Static codemode connector advertisement. The runtime itself is reachable
// inside work_code as `codemode.search()` / `codemode.describe(name)` /
// `codemode.run(name, input)` and dispatches to whichever underlying
// connector (workspace / machine / cloudbox) or snippet owns the tool.
const CODEMODE_METHODS = [
  { name: "search", description: "List or filter codemode tools across workspace, machine, cloudbox, and saved snippets." },
  { name: "describe", description: "Return the description and input schema for one codemode tool by qualified name." },
  { name: "run", description: "Invoke one codemode tool or saved snippet by name with a structured input." },
] as const;

export const WORK_SEARCH_TOOL: ToolDef = {
  name: "work_search",
  description: "Discover where My AX can do work. My AX Workspace is persistent conversation-adjacent storage and processes; My Machine is the connected physical computer with local/authenticated state; Cloudbox is a clean bounded repo run with receipts. Search before choosing when the destination is not obvious.",
  parameters: { type: "object", properties: { query: { type: "string", description: "What capability or kind of work is needed." } } },
  execute: async (args, ctx) => {
    checkedWorkspaceProvider(ctx);
    const machine = await createMachineWorkProvider(ctx);
    const snippets = ctx.listSavedRecipes ? await ctx.listSavedRecipes().catch(() => []) : [];
    const catalog = [
      ...WORKSPACE_METHODS.map((method) => catalogEntry("workspace", method.name, method.description)),
      ...machine.catalog.map((method) => catalogEntry("machine", method.name, method.description, machine.connected, method.inputSchema)),
      ...CLOUDBOX_WORK_METHODS.map((method) => catalogEntry("cloudbox", method.name, method.description, Boolean(ctx.env.CLOUDBOX_URL && ctx.env.CLOUDBOX_INTERNAL_TOKEN))),
      ...CODEMODE_METHODS.map((method) => catalogEntry("codemode", method.name, method.description, true)),
      ...snippets.map((snippet) => ({ method: `codemode:${snippet.name}`, where: "codemode" as const, description: snippet.description, available: true, inputSchema: snippet.inputSchema, capabilities: snippet.capabilities })),
    ];
    const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
    const filtered = query ? catalog.filter((entry) => `${entry.method} ${entry.description} ${entry.where}`.toLowerCase().includes(query)) : catalog;
    return JSON.stringify({ ok: true, places: { workspace: "My AX Workspace", machine: "My Machine", cloudbox: "Cloudbox" }, matches: filtered.length ? filtered : catalog });
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
      input: typeof input?.input === "object" && input.input ? input.input as Record<string, unknown> | undefined : {},
      callerCapabilities: ctx.allowedWorkCapabilities,
    }),
  };
}

export async function executeWorkCode(code: string, ctx: ToolContext) {
  if (!code || new TextEncoder().encode(code).byteLength > 32_000) return { ok: false, error: "code is required and must be <= 32000 bytes" };
  const machine = await createMachineWorkProvider(ctx);
  const cloudbox = createCloudboxWorkProvider(ctx);
  const calls: WorkCall[] = [];
  // Build the workspace/machine/cloudbox dispatchers up-front, then route them
  // through both the legacy raw bridge namespaces AND the new codemode runtime
  // so model code can call `workspace.read({...})` directly or hop through
  // `codemode.run("workspace.read", {...})` / `codemode.search()`.
  const workspaceFns = instrument("workspace", restrictByCapabilities("workspace", checkedWorkspaceProvider(ctx), ctx.allowedWorkCapabilities), calls);
  const machineFns = instrument("machine", restrictByCapabilities("machine", machine.fns, ctx.allowedWorkCapabilities), calls);
  const cloudboxFns = instrument("cloudbox", restrictByCapabilities("cloudbox", cloudbox.fns, ctx.allowedWorkCapabilities), calls);

  // Native codemode connector trio. Wrapping the same instrumented dispatchers
  // keeps a single receipt/cost path for both call styles.
  const codemodeSources: CodemodeWorkSource[] = [
    {
      connector: { name: "workspace", description: "My AX Workspace — persistent conversation-adjacent storage and processes.", tools: WORKSPACE_METHODS.map((method) => ({ name: method.name, description: method.description, execute: workspaceFns[method.name] })) },
      fns: workspaceFns,
    },
    {
      connector: { name: "machine", description: "My Machine — the connected physical computer with local/authenticated state.", tools: machine.catalog.map((method) => ({ name: method.name, description: method.description, inputSchema: method.inputSchema, execute: machineFns[method.name] ?? (async () => { throw new Error(`machine method ${method.name} not available`); }) })) },
      fns: machineFns,
    },
    {
      connector: { name: "cloudbox", description: "Cloudbox — a clean bounded repository run with receipts.", tools: CLOUDBOX_WORK_METHODS.map((method) => ({ name: method.name, description: method.description, execute: cloudboxFns[method.name] })) },
      fns: cloudboxFns,
    },
  ];
  const snippetHook = buildSnippetHook(ctx);
  const codemodeRuntime = createCodemodeWorkRuntime(codemodeSources, snippetHook);
  // Instrument the codemode entry points (search/describe/run) so their use
  // shows up in receipts and cost accounting alongside the underlying call.
  const instrumentedCodemodeBridge = instrument("codemode", {
    search: codemodeRuntime.bridgeFns["codemode__search"],
    describe: codemodeRuntime.bridgeFns["codemode__describe"],
    run: codemodeRuntime.bridgeFns["codemode__run"],
  }, calls);

  const bridgeFns = {
    ...Object.fromEntries(Object.entries(workspaceFns).map(([name, fn]) => [`workspace_${name}`, fn])),
    ...Object.fromEntries(Object.entries(machineFns).map(([name, fn]) => [`machine_${name}`, fn])),
    ...Object.fromEntries(Object.entries(cloudboxFns).map(([name, fn]) => [`cloudbox_${name}`, fn])),
    codemode__search: instrumentedCodemodeBridge.search,
    codemode__describe: instrumentedCodemodeBridge.describe,
    codemode__run: instrumentedCodemodeBridge.run,
  };
  const namespace = (name: string, methods: string[]) =>
    `globalThis.${name}={${methods.map((method) => `${JSON.stringify(method)}:(args)=>bridge[${JSON.stringify(`${name}_${method}`)}](args)`).join(",")}};`;
  const prelude = [
    namespace("workspace", Object.keys(workspaceFns)),
    namespace("machine", Object.keys(machineFns)),
    namespace("cloudbox", Object.keys(cloudboxFns)),
    codemodeRuntime.prelude,
    "globalThis.ctx={workspace:globalThis.workspace,machine:globalThis.machine,cloudbox:globalThis.cloudbox,codemode:globalThis.codemode};",
  ].join("\n");
  const submittedCode = code.trim().replace(/;+$/, "");
  const executableCode = `async () => await (${submittedCode})(globalThis.ctx)`;
  const executor = new DynamicWorkerExecutor({ loader: ctx.env.LOADER, globalOutbound: null, timeout: CODE_MODE_EXECUTION_TIMEOUT_MS });
  const execution = await executor.execute(executableCode, [{ name: "bridge", fns: bridgeFns, prelude }]);
  const sortedCalls = calls.sort((a, b) => a.index - b.index);
  const inferredCapabilities = [...new Set(sortedCalls.map((call) => `${call.where}.${call.method}`))].sort();
  // Portability signal: portable when it needs no host namespace — its logic
  // runs in any harness. Surfaced so the owner can tell shelf-worthy (portable)
  // snippets from machine-bound ones without reading the code. (recipe audit)
  const portable = isPortable(inferredCapabilities);
  return {
    ok: !execution.error,
    result: execution.result,
    ...(execution.error ? { error: execution.error } : {}),
    logs: execution.logs ?? [],
    calls: sortedCalls,
    sourceCode: code,
    inferredCapabilities,
    portable,
    suggestedRecipe: {
      description: suggestRecipeDescription(code, inferredCapabilities),
      inputSchema: { type: "object", properties: {} },
      // A meaningful proposed name derived from what the code does, so the owner
      // edits a real name instead of accepting `WorkCodeRecipe_<epoch>` (which
      // made 92% of the corpus undiscoverable — see the recipe audit).
      name: suggestRecipeName(code),
      code,
      capabilities: inferredCapabilities,
      portable,
    },
  };
}

export const WORK_CODE_TOOL: ToolDef = {
  name: "work_code",
  description: "Execute one bounded JavaScript async function across the right place for the job. Code must be an async arrow function. My AX Workspace methods: workspace.read({path}), workspace.write({path,content}) where path is a required file path such as /home/user/note.txt, workspace.list({path,recursive,includeHidden}), workspace.search({query,path,timeoutMs}), workspace.exec({command,cwd,timeoutMs}), workspace.process_start/status/logs/cancel, workspace.run_code, and workspace.preview_open/list/close. My Machine methods come from work_search with their inputSchema (for example machine.shell({command,cwd})). Cloudbox methods: cloudbox.run_create({repo}), cloudbox.run_read({runId,path}), cloudbox.run_write({runId,path,content}), and cloudbox.run_exec({runId,command}). A codemode-shaped namespace is also reachable as codemode.search(query) to discover tools and saved snippets, codemode.describe(name) to inspect one, and codemode.run(name, input) to invoke a tool or owner-approved snippet by name; snippet runs are bounded to the caller's capabilities (intersected, never widened), create receipts that carry the codemode execution id, and appear in Check-in. No raw network, credentials, environment, or publication authority is exposed.",
  parameters: { type: "object", properties: { code: { type: "string", description: "Async arrow function using workspace, machine, cloudbox, and/or codemode namespaces." } }, required: ["code"] },
  execute: async (args, ctx) => JSON.stringify(await executeWorkCode(typeof args.code === "string" ? args.code : "", ctx)),
};

import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { createCloudboxWorkProvider, CLOUDBOX_WORK_METHODS } from "./cloudbox-tools";
import { CODE_MODE_EXECUTION_TIMEOUT_MS } from "./code-mode-runtime";
import { createMachineWorkProvider } from "./routes/machinectl";
import type { ToolContext, ToolDef } from "./types";

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
  where: "workspace" | "machine" | "cloudbox" | "hammer";
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

function catalogEntry(where: WorkCall["where"], name: string, description: string, available = true, inputSchema?: unknown) {
  return { method: `${where}.${name}`, where, description, available, ...(inputSchema ? { inputSchema } : {}) };
}

export const WORK_SEARCH_TOOL: ToolDef = {
  name: "work_search",
  description: "Discover where My AX can do work. My AX Workspace is persistent conversation-adjacent storage and processes; My Machine is the connected physical computer with local/authenticated state; Cloudbox is a clean bounded repo run with receipts. Search before choosing when the destination is not obvious.",
  parameters: { type: "object", properties: { query: { type: "string", description: "What capability or kind of work is needed." } } },
  execute: async (args, ctx) => {
    checkedWorkspaceProvider(ctx);
    const machine = await createMachineWorkProvider(ctx);
    const hammers = ctx.listSavedHammers ? await ctx.listSavedHammers().catch(() => []) : [];
    const catalog = [
      ...WORKSPACE_METHODS.map((method) => catalogEntry("workspace", method.name, method.description)),
      ...machine.catalog.map((method) => catalogEntry("machine", method.name, method.description, machine.connected, method.inputSchema)),
      ...CLOUDBOX_WORK_METHODS.map((method) => catalogEntry("cloudbox", method.name, method.description, Boolean(ctx.env.CLOUDBOX_URL && ctx.env.CLOUDBOX_INTERNAL_TOKEN))),
      { method: "hammer.list", where: "hammer", description: "List enabled owner-approved saved hammers available in work_code.", available: Boolean(ctx.listSavedHammers) },
      ...hammers.map((hammer) => ({ method: `hammer.run:${hammer.name}`, where: "hammer", description: hammer.description, available: true, inputSchema: hammer.inputSchema, capabilities: hammer.capabilities })),
    ];
    const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
    const filtered = query ? catalog.filter((entry) => `${entry.method} ${entry.description} ${entry.where}`.toLowerCase().includes(query)) : catalog;
    return JSON.stringify({ ok: true, places: { workspace: "My AX Workspace", machine: "My Machine", cloudbox: "Cloudbox" }, matches: filtered.length ? filtered : catalog });
  },
};

export async function executeWorkCode(code: string, ctx: ToolContext) {
  if (!code || new TextEncoder().encode(code).byteLength > 32_000) return { ok: false, error: "code is required and must be <= 32000 bytes" };
  const machine = await createMachineWorkProvider(ctx);
  const cloudbox = createCloudboxWorkProvider(ctx);
  const calls: WorkCall[] = [];
  // Use one RPC dispatcher and construct the three public namespaces in the
  // trusted generated module. This avoids cross-provider dispatcher loss
  // while keeping the raw bridge and host bindings out of guest input.
  const workspaceFns = instrument("workspace", restrictByCapabilities("workspace", checkedWorkspaceProvider(ctx), ctx.allowedWorkCapabilities), calls);
  const machineFns = instrument("machine", restrictByCapabilities("machine", machine.fns, ctx.allowedWorkCapabilities), calls);
  const cloudboxFns = instrument("cloudbox", restrictByCapabilities("cloudbox", cloudbox.fns, ctx.allowedWorkCapabilities), calls);
  const hammerFns = ctx.exposeSavedHammers !== false && ctx.listSavedHammers && ctx.runSavedHammer ? instrument("hammer", {
    list: async () => ctx.listSavedHammers!(),
    run: async (input: any) => ctx.runSavedHammer!({
      id: typeof input?.id === "string" ? input.id : undefined,
      name: typeof input?.name === "string" ? input.name : undefined,
      input: typeof input?.input === "object" && input.input ? input.input as Record<string, unknown> : {},
    }),
  }, calls) : {};
  const bridgeFns = {
    ...Object.fromEntries(Object.entries(workspaceFns).map(([name, fn]) => [`workspace_${name}`, fn])),
    ...Object.fromEntries(Object.entries(machineFns).map(([name, fn]) => [`machine_${name}`, fn])),
    ...Object.fromEntries(Object.entries(cloudboxFns).map(([name, fn]) => [`cloudbox_${name}`, fn])),
    ...Object.fromEntries(Object.entries(hammerFns).map(([name, fn]) => [`hammer_${name}`, fn])),
  };
  const namespace = (name: string, methods: string[]) =>
    `globalThis.${name}={${methods.map((method) => `${JSON.stringify(method)}:(args)=>bridge[${JSON.stringify(`${name}_${method}`)}](args)`).join(",")}};`;
  const prelude = [
    namespace("workspace", Object.keys(workspaceFns)),
    namespace("machine", Object.keys(machineFns)),
    namespace("cloudbox", Object.keys(cloudboxFns)),
    namespace("hammer", Object.keys(hammerFns)),
  ].join("\n");
  const executor = new DynamicWorkerExecutor({ loader: ctx.env.LOADER, globalOutbound: null, timeout: CODE_MODE_EXECUTION_TIMEOUT_MS });
  const execution = await executor.execute(code, [{ name: "bridge", fns: bridgeFns, prelude }]);
  const sortedCalls = calls.sort((a, b) => a.index - b.index);
  const inferredCapabilities = [...new Set(sortedCalls.map((call) => `${call.where}.${call.method}`))].sort();
  return {
    ok: !execution.error,
    result: execution.result,
    ...(execution.error ? { error: execution.error } : {}),
    logs: execution.logs ?? [],
    calls: sortedCalls,
    sourceCode: code,
    inferredCapabilities,
    suggestedHammer: {
      description: "Promoted from a successful work_code run.",
      inputSchema: { type: "object", properties: {} },
      code,
      capabilities: inferredCapabilities,
    },
  };
}

export const WORK_CODE_TOOL: ToolDef = {
  name: "work_code",
  description: "Execute one bounded JavaScript async function across the right place for the job. Code must be an async arrow function. My AX Workspace methods: workspace.read({path}), workspace.write({path,content}) where path is a required file path such as /home/user/note.txt, workspace.list({path,recursive,includeHidden}), workspace.search({query,path,timeoutMs}), workspace.exec({command,cwd,timeoutMs}), workspace.process_start/status/logs/cancel, workspace.run_code, and workspace.preview_open/list/close. My Machine methods come from work_search with their inputSchema (for example machine.shell({command,cwd})). Cloudbox methods: cloudbox.run_create({repo}), cloudbox.run_read({runId,path}), cloudbox.run_write({runId,path,content}), and cloudbox.run_exec({runId,command}). Owner-approved saved hammers are exposed as hammer.list() and hammer.run({id|name,input}); hammer runs create receipts and appear in Check-in. No raw network, credentials, environment, or publication authority is exposed.",
  parameters: { type: "object", properties: { code: { type: "string", description: "Async arrow function using workspace, machine, and/or cloudbox namespaces." } }, required: ["code"] },
  execute: async (args, ctx) => JSON.stringify(await executeWorkCode(typeof args.code === "string" ? args.code : "", ctx)),
};

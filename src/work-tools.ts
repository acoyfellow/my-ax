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
  where: "workspace" | "machine" | "cloudbox";
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
    const catalog = [
      ...WORKSPACE_METHODS.map((method) => catalogEntry("workspace", method.name, method.description)),
      ...machine.catalog.map((method) => catalogEntry("machine", method.name, method.description, machine.connected, method.inputSchema)),
      ...CLOUDBOX_WORK_METHODS.map((method) => catalogEntry("cloudbox", method.name, method.description, Boolean(ctx.env.CLOUDBOX_URL && ctx.env.CLOUDBOX_INTERNAL_TOKEN))),
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
  const workspaceFns = instrument("workspace", checkedWorkspaceProvider(ctx), calls);
  const machineFns = instrument("machine", machine.fns, calls);
  const cloudboxFns = instrument("cloudbox", cloudbox.fns, calls);
  const bridgeFns = {
    ...Object.fromEntries(Object.entries(workspaceFns).map(([name, fn]) => [`workspace_${name}`, fn])),
    ...Object.fromEntries(Object.entries(machineFns).map(([name, fn]) => [`machine_${name}`, fn])),
    ...Object.fromEntries(Object.entries(cloudboxFns).map(([name, fn]) => [`cloudbox_${name}`, fn])),
  };
  const namespace = (name: string, methods: string[]) =>
    `globalThis.${name}={${methods.map((method) => `${JSON.stringify(method)}:(args)=>bridge[${JSON.stringify(`${name}_${method}`)}](args)`).join(",")}};`;
  const prelude = [
    namespace("workspace", Object.keys(workspaceFns)),
    namespace("machine", Object.keys(machineFns)),
    namespace("cloudbox", Object.keys(cloudboxFns)),
  ].join("\n");
  const executor = new DynamicWorkerExecutor({ loader: ctx.env.LOADER, globalOutbound: null, timeout: CODE_MODE_EXECUTION_TIMEOUT_MS });
  const execution = await executor.execute(code, [{ name: "bridge", fns: bridgeFns, prelude }]);
  return { ok: !execution.error, result: execution.result, ...(execution.error ? { error: execution.error } : {}), logs: execution.logs ?? [], calls: calls.sort((a, b) => a.index - b.index) };
}

export const WORK_CODE_TOOL: ToolDef = {
  name: "work_code",
  description: "Execute one bounded JavaScript async function across the right place for the job. Code must be an async arrow function. My AX Workspace methods: workspace.read({path}), workspace.write({path,content}) where path is a required file path such as /home/user/note.txt, workspace.list({path,recursive,includeHidden}), workspace.search({query,path,timeoutMs}), workspace.exec({command,cwd,timeoutMs}), workspace.process_start/status/logs/cancel, workspace.run_code, and workspace.preview_open/list/close. My Machine methods come from work_search with their inputSchema (for example machine.shell({command,cwd})). Cloudbox methods: cloudbox.run_create({repo}), cloudbox.run_read({runId,path}), cloudbox.run_write({runId,path,content}), and cloudbox.run_exec({runId,command}). No raw network, credentials, environment, or publication authority is exposed.",
  parameters: { type: "object", properties: { code: { type: "string", description: "Async arrow function using workspace, machine, and/or cloudbox namespaces." } }, required: ["code"] },
  execute: async (args, ctx) => JSON.stringify(await executeWorkCode(typeof args.code === "string" ? args.code : "", ctx)),
};

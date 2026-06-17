import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import type { ToolDef } from "./types";

function configuration(ctx: Parameters<ToolDef["execute"]>[1]) {
  const baseUrl = ctx.env.CLOUDBOX_URL?.replace(/\/+$/, "");
  const token = ctx.env.CLOUDBOX_INTERNAL_TOKEN;
  if (!baseUrl || !token) throw new Error("Cloudbox delegation is not configured");
  const owner = ctx.identity.email.toLowerCase();
  return {
    owner,
    baseUrl,
    url: `${baseUrl}/api/personal-computers/${encodeURIComponent(owner)}`,
    headers: { "content-type": "application/json", "x-cloudbox-internal-token": token, "x-cloudbox-owner": owner },
  };
}

async function cloudbox(ctx: Parameters<ToolDef["execute"]>[1], suffix: string, init?: RequestInit, root = false): Promise<unknown> {
  const config = configuration(ctx);
  const response = await fetch(`${root ? config.baseUrl : config.url}${suffix}`, { ...init, headers: { ...config.headers, ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.detail ?? body.error ?? `Cloudbox request failed: ${response.status}`));
  return body;
}

export const CLOUDBOX_WORK_METHODS = [
  { name: "run_create", description: "Create a bounded live Cloudbox run on a public GitHub repository." },
  { name: "run_read", description: "Read a safe relative file from a live run." },
  { name: "run_write", description: "Write a safe relative file in a live run." },
  { name: "run_exec", description: "Execute a bounded command in a live run." },
] as const;

export function createCloudboxWorkProvider(ctx: Parameters<ToolDef["execute"]>[1]) {
  return {
    catalog: CLOUDBOX_WORK_METHODS,
    fns: {
      run_create: async (input: any) => cloudbox(ctx, "/api/runs", { method: "POST", body: JSON.stringify({ repo: input?.repo, commands: input?.commands ?? [], verify: input?.verify ?? ["true"], live: true, ttlSeconds: Math.min(Number(input?.ttlSeconds ?? 3600), 86400) }) }, true),
      run_read: async (input: any) => cloudbox(ctx, `/api/runs/${encodeURIComponent(String(input?.runId ?? ""))}/read?path=${encodeURIComponent(String(input?.path ?? ""))}`, undefined, true),
      run_write: async (input: any) => cloudbox(ctx, `/api/runs/${encodeURIComponent(String(input?.runId ?? ""))}/write`, { method: "POST", body: JSON.stringify({ path: input?.path, content: input?.content }) }, true),
      run_exec: async (input: any) => cloudbox(ctx, `/api/runs/${encodeURIComponent(String(input?.runId ?? ""))}/exec`, { method: "POST", body: JSON.stringify({ command: input?.command, timeoutMs: input?.timeoutMs }) }, true),
    },
  };
}

export const CLOUDBOX_SEARCH_TOOL: ToolDef = {
  name: "cloudbox_search",
  description: "Discover the bounded Cloudbox Computer Code Mode catalog. Cloudbox is the durable cloud computer; use cloudbox_code to compose its methods in one execution.",
  parameters: { type: "object", properties: { query: { type: "string", description: "Optional keyword filter." } } },
  execute: async (args) => {
    const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
    return JSON.stringify({ ok: true, namespace: "cloudbox", methods: query ? CLOUDBOX_WORK_METHODS.filter((method) => `${method.name} ${method.description}`.toLowerCase().includes(query)) : CLOUDBOX_WORK_METHODS });
  },
};

export const CLOUDBOX_CODE_TOOL: ToolDef = {
  name: "cloudbox_code",
  description: "Execute one bounded JavaScript async function that orchestrates Cloudbox live-run capabilities. Write `async () => { ... }` and call cloudbox.run_create({repo}), cloudbox.run_read({runId,path}), cloudbox.run_write({runId,path,content}), and cloudbox.run_exec({runId,command}). No network, credentials, raw bindings, or publication capability is available inside guest code.",
  parameters: {
    type: "object",
    properties: { code: { type: "string", description: "An async arrow function using the injected cloudbox namespace." } },
    required: ["code"],
  },
  execute: async (args, ctx) => {
    const code = typeof args.code === "string" ? args.code : "";
    if (!code || new TextEncoder().encode(code).byteLength > 32_000) return JSON.stringify({ ok: false, error: "code is required and must be <= 32000 bytes" });
    const provider = createCloudboxWorkProvider(ctx);
    const executor = new DynamicWorkerExecutor({ loader: ctx.env.LOADER, globalOutbound: null, timeout: 30_000 });
    const execution = await executor.execute(code, [{ name: "cloudbox", fns: provider.fns }]);
    if (execution.error) return JSON.stringify({ ok: false, error: execution.error });
    return JSON.stringify({ ok: true, result: execution.result, logs: execution.logs ?? [], methods: Object.keys(provider.fns) });
  },
};

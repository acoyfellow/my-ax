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

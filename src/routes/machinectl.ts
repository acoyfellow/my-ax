// routes/machinectl.ts — Access-scoped entrypoints for the user's laptop MCP.
// The authenticated user's email names one MachineHost DO. Latest outbound
// laptop WebSocket wins; MCP traffic is routed only to that user's DO.

import { DynamicWorkerExecutor, sanitizeToolName } from "@cloudflare/codemode";
import type { Context, Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ToolDef } from "../types";
import { appendOwnedRunEvent, RunReceiptNotFoundError } from "../run-receipts";
import { storeInlineMediaArtifact } from "../uploads";
import { parseMachineShellContent } from "../machinectl-output";

interface PublishedTool { name: string; description: string; inputSchema: Record<string, unknown> }
type MachineResult = { ok?: boolean; content?: string; error?: string };
type ObserveSessionBody = { runId?: string; session?: { harness?: string; id?: string; label?: string; state?: string }; note?: string };
const MACHINE_STATUS_CACHE_MS = 5_000;
const SESSION_HARNESS_IDS = new Set(["pi", "vscode"]);
const machineStatusCache = new Map<string, { at: number; status: { connected: boolean; machineName?: string; tools?: PublishedTool[] } }>();

function hostFor(c: Context<AppEnv>) {
  const email = c.get("identity").email.toLowerCase();
  return c.env.MACHINE_HOST.get(c.env.MACHINE_HOST.idFromName(email));
}

export function registerMachinectlRoutes(app: Hono<AppEnv>) {
  app.get("/machinectl/connect", async (c) => {
    const headers = new Headers(c.req.raw.headers);
    headers.set("X-Machinectl-User", c.get("identity").email.toLowerCase());
    return hostFor(c).fetch(new Request("http://internal/connect", { method: "GET", headers }));
  });
  app.post("/machinectl/mcp", async (c) => {
    const headers = new Headers(c.req.raw.headers);
    headers.set("X-Machinectl-User", c.get("identity").email.toLowerCase());
    return hostFor(c).fetch(new Request("http://internal/mcp", { method: "POST", headers, body: c.req.raw.body }));
  });
  app.get("/api/machinectl/status", async (c) => hostFor(c).fetch("http://internal/status"));
  // Explicit live-attach-adjacent slice: record one caller-supplied identity
  // for a session the owner already observed on their connected laptop. This
  // appends a receipt event only; it does not discover, attach, mirror, or steer.
  app.post("/api/machinectl/observations/session", async (c) => {
    const body = await c.req.json<ObserveSessionBody>().catch(() => null);
    const runId = body?.runId?.trim() ?? "";
    const harness = body?.session?.harness?.trim().toLowerCase() ?? "";
    const sessionId = body?.session?.id?.trim() ?? "";
    if (!runId) return c.json({ ok: false, error: { code: "BAD_RUN_ID", message: "runId is required" } }, 400);
    if (!SESSION_HARNESS_IDS.has(harness)) return c.json({ ok: false, error: { code: "BAD_SESSION_HARNESS", message: "session.harness must be pi or vscode" } }, 400);
    if (!sessionId) return c.json({ ok: false, error: { code: "BAD_SESSION_ID", message: "session.id is required" } }, 400);

    const status = await hostFor(c).fetch("http://internal/status").then((response) => response.json<{ connected?: boolean; machineName?: string | null }>());
    if (!status.connected) return c.json({ ok: false, error: { code: "LAPTOP_NOT_CONNECTED", message: "No laptop is currently connected." } }, 409);

    try {
      const event = await appendOwnedRunEvent(c, runId, {
        actor: { id: `machinectl:${status.machineName ?? "connected-laptop"}`, kind: "machinectl", mode: "live" },
        type: "machinectl.observation.captured",
        data: {
          observation: "connected-laptop-session",
          machineName: status.machineName ?? null,
          session: {
            harness,
            id: sessionId,
            ...(body?.session?.label?.trim() ? { label: body.session.label.trim() } : {}),
            ...(body?.session?.state?.trim() ? { state: body.session.state.trim() } : {}),
          },
          ...(body?.note?.trim() ? { note: body.note.trim() } : {}),
          explicit: true,
          noTranscript: true,
          noAttach: true,
        },
      });
      return c.json({ ok: true, command: c.req.path, result: event, next_actions: [{ command: `GET /runs/${runId}`, description: "Open the Run Board" }] }, 201);
    } catch (error) {
      if (error instanceof RunReceiptNotFoundError) return c.json({ ok: false, command: c.req.path, error: { code: "RUN_NOT_FOUND", message: error.message }, next_actions: [] }, 404);
      throw error;
    }
  });
  // Local-dev/native-agent proof endpoint. Keeps laptop invocation testable
  // without spinning a Think chat turn; still Access-gated by /api/* middleware.
  app.post("/api/machinectl/call", async (c) => {
    const body = await c.req.json<{ tool?: string; arguments?: Record<string, unknown> }>().catch(() => null);
    if (!body?.tool) return c.json({ ok: false, error: "tool is required" }, 400);
    if (body.tool === "tools/list") return hostFor(c).fetch("http://internal/status");
    const headers = new Headers({ "Content-Type": "application/json", "X-Machinectl-User": c.get("identity").email.toLowerCase() });
    const response = await hostFor(c).fetch("http://internal/invoke", { method: "POST", headers, body: JSON.stringify({ tool: body.tool, args: body.arguments ?? {} }) });
    if (body.tool !== "screenshot" && body.tool !== "screen_record") return response;
    const result = await response.json<{ ok?: boolean; content?: string; error?: string }>();
    if (result.ok && typeof result.content === "string") {
      const artifact = await storeInlineMediaArtifact(c.env, c.get("identity"), result.content);
      if (artifact) return c.json({ ...result, content: artifact });
    }
    return c.json(result);
  });
  app.post("/api/machinectl/code", async (c) => {
    const body = await c.req.json<{ code?: string }>().catch(() => null);
    if (!body?.code) return c.json({ ok: false, error: "code is required" }, 400);
    if (body.code.length > 32_000) return c.json({ ok: false, error: "code exceeds 32000 characters" }, 413);
    const context = { env: c.env, identity: c.get("identity") } as Parameters<ToolDef["execute"]>[1];
    return c.json(JSON.parse(await MACHINECTL_CODE_TOOL.execute({ code: body.code }, context)) as Record<string, unknown>);
  });

}

async function machineStatus(ctx: Parameters<ToolDef["execute"]>[1]) {
  const key = ctx.identity.email.toLowerCase();
  const cached = machineStatusCache.get(key);
  if (cached && Date.now() - cached.at < MACHINE_STATUS_CACHE_MS) return cached.status;
  const host = ctx.env.MACHINE_HOST.get(ctx.env.MACHINE_HOST.idFromName(key));
  const status = await host.fetch("http://internal/status").then((response) => response.json<{ connected: boolean; machineName?: string; tools?: PublishedTool[] }>());
  machineStatusCache.set(key, { at: Date.now(), status });
  return status;
}

function schemaType(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "unknown";
  const value = schema as Record<string, unknown>;
  if (Array.isArray(value.enum)) return value.enum.map((entry) => JSON.stringify(entry)).join(" | ");
  if (value.type === "string") return "string";
  if (value.type === "number" || value.type === "integer") return "number";
  if (value.type === "boolean") return "boolean";
  if (value.type === "array") return `Array<${schemaType(value.items)}>`;
  if (value.type === "object") {
    const fields = (value.properties ?? {}) as Record<string, unknown>;
    const required = new Set(Array.isArray(value.required) ? value.required.map(String) : []);
    return `{ ${Object.entries(fields).map(([key, field]) => `${key}${required.has(key) ? "" : "?"}: ${schemaType(field)}`).join("; ")} }`;
  }
  return "unknown";
}

function laptopTypes(catalog: PublishedTool[]): string {
  return `declare const codemode: {\n${catalog.map((tool) => `  /** ${tool.description.replaceAll("*/", "* /")} */\n  ${sanitizeToolName(tool.name)}: (args: ${schemaType(tool.inputSchema)}) => Promise<unknown>;`).join("\n\n")}\n};`;
}

async function machineInvoke(tool: string, args: Record<string, unknown>, ctx: Parameters<ToolDef["execute"]>[1]): Promise<MachineResult> {
  const host = ctx.env.MACHINE_HOST.get(ctx.env.MACHINE_HOST.idFromName(ctx.identity.email.toLowerCase()));
  const headers = new Headers({ "Content-Type": "application/json", "X-Machinectl-User": ctx.identity.email.toLowerCase() });
  const response = await host.fetch("http://internal/invoke", { method: "POST", headers, body: JSON.stringify({ tool, args }) });
  return response.json<MachineResult>();
}

export async function createMachineWorkProvider(ctx: Parameters<ToolDef["execute"]>[1]) {
  const status = await machineStatus(ctx);
  const catalog = status.tools ?? [];
  const fns: Record<string, (input: unknown) => Promise<unknown>> = {};
  for (const published of catalog) {
    fns[published.name] = async (input) => {
      const result = await machineInvoke(published.name, (input && typeof input === "object" ? input : {}) as Record<string, unknown>, ctx);
      if (!result.ok) throw new Error(result.error ?? `Laptop tool failed: ${published.name}`);
      if ((published.name === "screenshot" || published.name === "screen_record") && typeof result.content === "string") {
        const artifact = await storeInlineMediaArtifact(ctx.env, ctx.identity, result.content);
        if (artifact) return artifact;
      }
      if (published.name === "shell") return parseMachineShellContent(result.content ?? "");
      try { return JSON.parse(result.content ?? "") as unknown; } catch { return result.content ?? ""; }
    };
  }
  return { connected: status.connected, machineName: status.machineName, catalog, fns };
}

export const MACHINECTL_CODE_TOOL: ToolDef = {
  name: "machinectl_code",
  description: "Execute JavaScript against the user's explicitly connected physical laptop through isolated Code Mode. Use this as the default laptop-control interface after the user explicitly asks to operate or inspect their laptop. Discover the live catalog first. Prefer semantic cmux_workspace_* and cmux_pi_* tools for durable cmux/Pi sessions when available; prefer harness_* for daemon-owned agents; use GUI controls only as fallback. Batch GUI actions with input_sequence and use compressed screenshot previews unless exact PNG pixels are required. Underlying shell remains terminal-equivalent; Code Mode isolates orchestration and does not reduce laptop authority.",
  parameters: {
    type: "object",
    properties: { code: { type: "string", description: "JavaScript async arrow function using codemode.<laptop_tool>(args)." } },
    required: ["code"],
  },
  execute: async (args, ctx) => {
    const code = typeof args.code === "string" ? args.code : "";
    if (!code) return JSON.stringify({ ok: false, error: "code is required" });
    if (code.length > 32_000) return JSON.stringify({ ok: false, error: "code exceeds 32000 characters" });
    const provider = await createMachineWorkProvider(ctx);
    if (!provider.connected) return JSON.stringify({ ok: false, error: "No laptop is currently connected." });
    const types = laptopTypes(provider.catalog);
    const executor = new DynamicWorkerExecutor({ loader: ctx.env.LOADER, globalOutbound: null, timeout: 30_000 });
    const execution = await executor.execute(code, [{ name: "codemode", fns: provider.fns }]);
    if (execution.error) return JSON.stringify({ ok: false, error: execution.error, available: types });
    return JSON.stringify({ ok: true, result: execution.result, logs: execution.logs ?? [], availableMethods: provider.catalog.map((tool) => sanitizeToolName(tool.name)) });
  },
};

export const MACHINECTL_TOOL: ToolDef = {
  name: "machinectl_call",
  description: "Discover or directly invoke a physical-laptop tool. Prefer machinectl_code for ordinary requested laptop operation; use this direct tool for tools/list discovery, screenshot rendering, compatibility, or narrow diagnostics. Core controls are shell, screenshot, mouse, keyboard and input_sequence. Optional semantic cmux controls expose workspace discovery, bounded Pi terminal tails, verified prompt/steer/abort, and local focus without exposing the cmux socket. Optional delegated-agent controls use harness_*. Discover the live catalog before assuming either adapter is enabled.",
  parameters: {
    type: "object",
    properties: {
      tool: { type: "string", description: "Laptop tool name, or the special discovery value tools/list." },
      arguments: { type: "object", description: "Arguments for the laptop tool." },
    },
    required: ["tool"],
  },
  execute: async (args, ctx) => {
    const tool = typeof args.tool === "string" ? args.tool.trim() : "";
    // Reject a missing/empty tool immediately with an actionable message the
    // model can recover from. Without this, an empty call was forwarded as
    // tool="" and persisted as an incomplete tool part that rendered RUNNING
    // forever in history. Fail fast and tell the model exactly what to do.
    if (!tool) {
      return JSON.stringify({
        ok: false,
        error: "machinectl_call requires a non-empty `tool`. Call machinectl_call with { tool: \"tools/list\" } to discover available laptop tools, then call again with a real tool name (e.g. shell, screenshot) and its arguments.",
      });
    }
    const { identity, env } = ctx;
    const host = env.MACHINE_HOST.get(env.MACHINE_HOST.idFromName(identity.email.toLowerCase()));
    if (tool === "tools/list") {
      const status = await host.fetch("http://internal/status").then((response) => response.json<{ connected: boolean; machineName?: string; tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }>());
      return JSON.stringify(status);
    }
    const headers = new Headers({ "Content-Type": "application/json", "X-Machinectl-User": identity.email.toLowerCase() });
    const response = await host.fetch("http://internal/invoke", { method: "POST", headers, body: JSON.stringify({ tool, args: (args.arguments as Record<string, unknown> | undefined) ?? {} }) });
    const result = await response.json<{ ok?: boolean; content?: string; error?: string }>();
    if ((tool === "screenshot" || tool === "screen_record") && result.ok && typeof result.content === "string") {
      const artifact = await storeInlineMediaArtifact(env, identity, result.content);
      if (artifact) return JSON.stringify({ ...result, content: artifact });
    }
    return JSON.stringify(result);
  },
};

// machinectl-host.ts — per-user bridge from an Access-authenticated MCP caller
// to one outbound-connected laptop daemon.
//
// The laptop connects over WebSocket and publishes a tool catalog. MCP clients
// POST initialize/tools/list/tools/call to the same Durable Object. Tool calls
// are forwarded over the existing socket, then receipt-logged to AUDIT_KV.

import { DurableObject } from "cloudflare:workers";

interface PublishedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

type LaptopFrame =
  | { type: "hello"; machineName: string; tools: PublishedTool[] }
  | { type: "result"; id: string; ok: true; content: string; metrics?: { toolExecMs?: number; resultBytes?: number } }
  | { type: "result"; id: string; ok: false; error: string; metrics?: { toolExecMs?: number; resultBytes?: number } }
  | { type: "ping" }
  | { type: "pong" };

type HostEnv = { AUDIT_KV?: KVNamespace };
type SocketAttachment = { connectedAt: number; generation: string };
type PendingCall = {
  resolve: (result: ToolResult) => void;
  timer: ReturnType<typeof setTimeout>;
  tool: string;
  dispatchedAt: number;
};
type ToolResult = { ok: true; content: string } | { ok: false; error: string };

const TOOL_LIMIT = 64;
const CATALOG_BYTE_LIMIT = 128 * 1024;
const ARGS_BYTE_LIMIT = 128 * 1024;
const RESULT_BYTE_LIMIT = 512 * 1024;
const MAX_PENDING_CALLS = 8;
const CALL_TIMEOUT_MS = 60 * 1000;
const AUDIT_TTL_SECONDS = 60 * 60 * 24 * 30;
const MACHINE_NAME_KEY = "machineName";
const MACHINE_USER_KEY = "user";
const TOOLS_KEY = "tools";
const SOCKET_GENERATION_KEY = "socketGeneration";

function text(value: string, isError = false) {
  return { content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) };
}

function rpc(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
}

function safeText(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  return value.slice(0, maxBytes) + "\n... (truncated by relay)";
}

function validateTools(tools: unknown): tools is PublishedTool[] {
  if (!Array.isArray(tools) || tools.length > TOOL_LIMIT || byteLength(tools) > CATALOG_BYTE_LIMIT) return false;
  return tools.every((tool) => {
    if (!tool || typeof tool !== "object") return false;
    const value = tool as Record<string, unknown>;
    return typeof value.name === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(value.name) &&
      typeof value.description === "string" && value.description.length <= 2_000 &&
      !!value.inputSchema && typeof value.inputSchema === "object";
  });
}

function summarizeArgs(tool: string, args: Record<string, unknown>) {
  const allowedKeys = tool === "shell"
    ? ["cwd", "timeoutMs"]
    : tool === "mouse"
      ? ["action", "x", "y", "delta"]
      : tool === "keyboard"
        ? ["action", "key", "modifiers"]
        : tool === "screenshot"
          ? ["format", "quality", "maxWidth", "fullResolution", "display", "region"]
          : tool === "input_sequence"
            ? []
      : tool === "harness_start" || tool === "pi_start"
        ? ["harnessId", "cwd", "model", "thinking", "continueRecent"]
        : ["harness_status", "harness_stop", "harness_abort", "harness_control", "pi_status", "pi_stop", "pi_abort", "pi_command"].includes(tool)
          ? ["harnessId", "id", "command"]
          : tool.startsWith("cmux_")
            ? ["workspaceId", "surfaceId", "lines"]
            : [];
  const summary: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (key in args) summary[key] = args[key];
  }
  return {
    keys: Object.keys(args),
    byteLength: byteLength(args),
    safe: summary,
    contentRedacted: Object.keys(args).some((key) => !allowedKeys.includes(key)),
  };
}

export class MachineHost extends DurableObject<HostEnv> {
  private readonly pending = new Map<string, PendingCall>();
  private cachedTools?: PublishedTool[];
  private cachedMachineName?: string;
  private cachedMachineUser?: string;

  constructor(ctx: DurableObjectState, env: HostEnv) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/connect") return this.acceptLaptopConnection(request);
    if (url.pathname === "/mcp") return this.mcp(request);
    if (url.pathname === "/invoke") return this.invoke(request);
    if (url.pathname === "/status") {
      const connected = this.socket() !== null;
      const [tools, machineName] = connected ? await Promise.all([this.tools(), this.machineName()]) : [[], null];
      return Response.json({ connected, machineName, tools });
    }
    return new Response("not found", { status: 404 });
  }

  private socket(): WebSocket | null {
    // A replacement connection can briefly coexist with its closing
    // predecessor. Always select the newest still-open socket rather than an
    // arbitrary tagged socket, or status/invocation can target a dead relay.
    return this.ctx.getWebSockets("laptop")
      .filter((socket) => socket.readyState === WebSocket.OPEN)
      .sort((a, b) => {
        const left = (a.deserializeAttachment() as SocketAttachment | null)?.connectedAt ?? 0;
        const right = (b.deserializeAttachment() as SocketAttachment | null)?.connectedAt ?? 0;
        return right - left;
      })[0] ?? null;
  }

  private async acceptLaptopConnection(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }
    for (const old of this.ctx.getWebSockets("laptop")) {
      try { old.close(1012, "new laptop connection replaced this one"); } catch { /* already gone */ }
    }
    const user = request.headers.get("X-Machinectl-User") ?? "unknown";
    const generation = crypto.randomUUID();
    this.cachedTools = undefined;
    this.cachedMachineName = undefined;
    this.cachedMachineUser = user;
    this.rejectPending("Laptop connection replaced while executing the tool call.");
    await this.ctx.storage.put({ [MACHINE_USER_KEY]: user, [SOCKET_GENERATION_KEY]: generation });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ connectedAt: Date.now(), generation } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server, ["laptop"]);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    let frame: LaptopFrame;
    try {
      frame = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)) as LaptopFrame;
    } catch {
      return;
    }
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    const activeGeneration = await this.ctx.storage.get<string>(SOCKET_GENERATION_KEY);
    if (!attachment?.generation || attachment.generation !== activeGeneration) return;
    if (frame.type === "hello") {
      if (frame.machineName.length > 128 || !validateTools(frame.tools)) {
        ws.close(1008, "invalid tool catalog");
        return;
      }
      this.cachedMachineName = frame.machineName;
      this.cachedTools = frame.tools;
      await this.ctx.storage.put({ [MACHINE_NAME_KEY]: frame.machineName, [TOOLS_KEY]: frame.tools });
      return;
    }
    if (frame.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (frame.type !== "result") return;
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(frame.id);
    console.log("machinectl_tool_timing", { tool: pending.tool, roundTripMs: Date.now() - pending.dispatchedAt, toolExecMs: frame.metrics?.toolExecMs ?? null, resultBytes: frame.metrics?.resultBytes ?? (frame.ok ? byteLength(frame.content) : byteLength(frame.error)) });
    pending.resolve(frame.ok
      ? { ok: true, content: safeText(frame.content, RESULT_BYTE_LIMIT) }
      : { ok: false, error: safeText(frame.error, 8_192) });
  }

  private async clearActiveSocket(ws: WebSocket, error: string): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    const activeGeneration = await this.ctx.storage.get<string>(SOCKET_GENERATION_KEY);
    // Never let a late close/error from a superseded socket erase a newer
    // laptop connection's advertised state.
    if (!attachment?.generation || attachment.generation === activeGeneration) {
      this.cachedTools = undefined;
      this.cachedMachineName = undefined;
      this.cachedMachineUser = undefined;
      await this.ctx.storage.delete([MACHINE_NAME_KEY, MACHINE_USER_KEY, TOOLS_KEY, SOCKET_GENERATION_KEY]);
      this.rejectPending(error);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.clearActiveSocket(ws, "Laptop disconnected while executing the tool call.");
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.clearActiveSocket(ws, "Laptop WebSocket failed while executing the tool call.");
  }

  private rejectPending(error: string) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.resolve({ ok: false, error });
    }
  }

  private async tools(): Promise<PublishedTool[]> { return this.cachedTools ??= (await this.ctx.storage.get<PublishedTool[]>(TOOLS_KEY)) ?? []; }
  private async machineName(): Promise<string | null> { this.cachedMachineName ??= (await this.ctx.storage.get<string>(MACHINE_NAME_KEY)) ?? undefined; return this.cachedMachineName ?? null; }
  private async machineUser(): Promise<string> { this.cachedMachineUser ??= (await this.ctx.storage.get<string>(MACHINE_USER_KEY)) ?? "unknown"; return this.cachedMachineUser; }

  private async invoke(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("POST required", { status: 405 });
    const bodyText = await request.text();
    if (byteLength(bodyText) > ARGS_BYTE_LIMIT) return new Response("request too large", { status: 413 });
    const body = await Promise.resolve().then(() => JSON.parse(bodyText) as { tool?: string; args?: Record<string, unknown> }).catch(() => null);
    if (!body?.tool) return Response.json({ ok: false, error: "tool is required" }, { status: 400 });
    const tools = this.socket() ? await this.tools() : [];
    if (!tools.some((candidate) => candidate.name === body.tool)) {
      return Response.json({ ok: false, error: `Tool not available on the connected laptop: ${body.tool}` });
    }
    if (this.pending.size >= MAX_PENDING_CALLS) return Response.json({ ok: false, error: "Laptop busy: too many in-flight calls." });
    const result = await this.callLaptop(body.tool, body.args ?? {});
    const machineName = (await this.machineName()) ?? "unknown";
    const user = request.headers.get("X-Machinectl-User") ?? await this.machineUser();
    this.ctx.waitUntil(this.audit(user, machineName, body.tool, body.args ?? {}, result).catch((error) => console.error("machinectl_receipt_failed", error)));
    return Response.json(result);
  }

  private async mcp(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("POST required", { status: 405 });
    const bodyText = await request.text();
    if (byteLength(bodyText) > ARGS_BYTE_LIMIT) return new Response("request too large", { status: 413 });
    const body = await Promise.resolve().then(() => JSON.parse(bodyText) as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }).catch(() => null);
    if (!body?.method) return Response.json(rpcError(null, -32600, "Invalid request"), { status: 400 });
    if (body.method === "initialize") return Response.json(rpc(body.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "machinectl", version: "0.1.0" } }), { headers: { "mcp-session-id": "machinectl-access-session" } });
    if (body.method === "notifications/initialized") return new Response(null, { status: 204 });
    if (body.method === "ping") return Response.json(rpc(body.id, {}));
    const socket = this.socket();
    const tools = socket ? await this.tools() : [];
    if (body.method === "tools/list") return Response.json(rpc(body.id, { tools }));
    if (body.method !== "tools/call") return Response.json(rpcError(body.id, -32601, "Method not found"), { status: 404 });
    const tool = body.params?.name;
    const args = body.params?.arguments ?? {};
    if (!tool || !tools.some((candidate) => candidate.name === tool)) {
      return Response.json(rpc(body.id, text(`Tool not available on the connected laptop: ${tool ?? "(missing)"}`, true)));
    }
    if (this.pending.size >= MAX_PENDING_CALLS) return Response.json(rpc(body.id, text("Laptop busy: too many in-flight calls.", true)));
    const result = await this.callLaptop(tool, args);
    const machineName = (await this.machineName()) ?? "unknown";
    const user = request.headers.get("X-Machinectl-User") ?? await this.machineUser();
    this.ctx.waitUntil(this.audit(user, machineName, tool, args, result).catch((error) => console.error("machinectl_receipt_failed", error)));
    return Response.json(rpc(body.id, result.ok ? text(result.content) : text(result.error, true)));
  }

  private callLaptop(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    const socket = this.socket();
    if (!socket) return Promise.resolve({ ok: false, error: "No laptop is currently connected." });
    const id = crypto.randomUUID();
    return new Promise<ToolResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: `Tool call timed out after ${CALL_TIMEOUT_MS}ms: ${tool}` });
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer, tool, dispatchedAt: Date.now() });
      try {
        socket.send(JSON.stringify({ type: "call", id, tool, args }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        const error = `Failed forwarding tool call to laptop: ${(err as Error).message}`;
        resolve({ ok: false, error });
        // send() may fail before a close/error callback is delivered. Clear
        // current status immediately so discovery does not keep reporting a
        // dead operational relay as connected.
        try { socket.close(1011, "forwarding failed"); } catch { /* already closed */ }
        void this.clearActiveSocket(socket, error);
      }
    });
  }

  private async audit(user: string, machineName: string, tool: string, args: Record<string, unknown>, result: ToolResult): Promise<void> {
    if (!this.env.AUDIT_KV) return;
    const timestamp = Date.now();
    const receipt = {
      schema: "machinectl.audit-receipt.v1",
      timestamp: new Date(timestamp).toISOString(),
      user,
      machineName,
      tool,
      request: summarizeArgs(tool, args),
      result: {
        ok: result.ok,
        byteLength: byteLength(result.ok ? result.content : result.error),
        contentStored: false,
      },
    };
    await this.env.AUDIT_KV.put(`machinectl:${user}:${timestamp}:${crypto.randomUUID()}`, JSON.stringify(receipt), { expirationTtl: AUDIT_TTL_SECONDS });
  }
}

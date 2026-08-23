import type { ToolDef } from "./types";

type Ctx = Parameters<ToolDef["execute"]>[1];

const PRODUCTION_ORIGIN = "https://api.agentcast.dev";
const READY = new Set(["ready", "active"]);
const PROFILE_ID = "my-ax";
const CREATE_PERMISSIONS = ["sessions:create"] as const;
const SESSION_PERMISSIONS = [
  "session:observe",
  "session:input",
  "session:control",
  "cdp:full",
  "network:record",
  "network:receipt",
] as const;

function configuration(ctx: Ctx) {
  const issuerKey = ctx.env.AGENTCAST_ISSUER_KEY || ctx.env.AGENTCAST_CONTROL_TOKEN;
  if (!issuerKey) throw new Error("AgentCast is not configured (AGENTCAST_ISSUER_KEY required)");
  const origin = (ctx.env.AGENTCAST_URL || PRODUCTION_ORIGIN).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("AGENTCAST_URL must be an absolute URL");
  }
  if (parsed.protocol !== "https:") throw new Error("AGENTCAST_URL must be https");
  if (parsed.hostname.endsWith(".workers.dev")) throw new Error("AGENTCAST_URL must not be workers.dev");
  return { origin: parsed.origin, issuerKey };
}

async function issueCapability(ctx: Ctx, sessionId: string, permissions: readonly string[]): Promise<string> {
  const { origin, issuerKey } = configuration(ctx);
  const res = await fetch(`${origin}/internal/capabilities`, {
    method: "POST",
    headers: { authorization: `Bearer ${issuerKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      tenantId: "owner",
      sessionId,
      profileId: PROFILE_ID,
      permissions,
      audience: origin,
      ttlMs: 5 * 60 * 1000,
    }),
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try { json = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { json = { raw: text }; }
  if (!res.ok || typeof json.token !== "string") {
    throw new Error(String(json.error ?? json.raw ?? `AgentCast capability issue failed (HTTP ${res.status})`));
  }
  return json.token;
}

async function agentcast(ctx: Ctx, method: string, path: string, sessionId: string, permissions: readonly string[], body?: unknown): Promise<{ code: number; json: Record<string, unknown> }> {
  const { origin } = configuration(ctx);
  const token = await issueCapability(ctx, sessionId, permissions);
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${origin}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try { json = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { json = { raw: text }; }
  return { code: res.status, json };
}

function fail(path: string, result: { code: number; json: Record<string, unknown> }): never {
  throw new Error(String(result.json.error ?? result.json.raw ?? `AgentCast ${path} failed (HTTP ${result.code})`));
}

async function requireOk(ctx: Ctx, method: string, path: string, sessionId: string, permissions: readonly string[], body?: unknown): Promise<Record<string, unknown>> {
  const result = await agentcast(ctx, method, path, sessionId, permissions, body);
  if (result.code < 200 || result.code >= 300) fail(path, result);
  return result.json;
}

const READY_ATTEMPTS = 120;
const READY_INTERVAL_MS = 250;

function readyBudget(ctx: Ctx): { attempts: number; intervalMs: number } {
  const intervalMs = Number(ctx.env.AGENTCAST_READY_INTERVAL_MS ?? READY_INTERVAL_MS);
  const attempts = Number(ctx.env.AGENTCAST_READY_ATTEMPTS ?? READY_ATTEMPTS);
  return {
    attempts: Number.isFinite(attempts) && attempts > 0 ? attempts : READY_ATTEMPTS,
    intervalMs: Number.isFinite(intervalMs) && intervalMs >= 0 ? intervalMs : READY_INTERVAL_MS,
  };
}

async function waitReady(ctx: Ctx, sessionId: string): Promise<Record<string, unknown>> {
  const { attempts, intervalMs } = readyBudget(ctx);
  let last: Record<string, unknown> = {};
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await requireOk(ctx, "GET", `/api/session/${sessionId}`, sessionId, SESSION_PERMISSIONS);
    const status = String(last.status ?? "");
    if (READY.has(status)) return last;
    if (status === "error") throw new Error(String(last.error ?? "Browser session failed"));
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const waited = Math.round((attempts * intervalMs) / 1000);
  throw new Error(String(last.error ?? `Browser session was not ready after ${waited}s`));
}

async function stopSessionQuietly(ctx: Ctx, sessionId: string): Promise<void> {
  await agentcast(ctx, "POST", `/api/session/${sessionId}/stop`, sessionId, SESSION_PERMISSIONS).catch(() => undefined);
}

export const AGENTCAST_WORK_METHODS = [
  { name: "open", description: "Create a logged-in AgentCast browser on api.agentcast.dev over HTTPS, wait until ready, wake it, and run one instruction. Input: {instruction, name?}. Returns {ok, sessionId, status, ticketUrl, transport}." },
  { name: "instruct", description: "Send one natural-language instruction to an existing AgentCast session over HTTPS. Input: {sessionId, instruction}." },
  { name: "status", description: "Read AgentCast session status over HTTPS. Input: {sessionId}." },
  { name: "record", description: "Wake, start, and stop a bounded HAR capture. Returns only a redacted receipt. Input: {sessionId, maxDurationMs?, maxEntries?}." },
  { name: "stop", description: "Stop an AgentCast browser session and free registry capacity. Input: {sessionId}." },
] as const;

export function createAgentCastWorkProvider(ctx: Ctx) {
  return {
    catalog: AGENTCAST_WORK_METHODS,
    available: Boolean(ctx.env.AGENTCAST_ISSUER_KEY || ctx.env.AGENTCAST_CONTROL_TOKEN),
    fns: {
      open: async (input: any) => {
        const instruction = String(input?.instruction ?? "").trim();
        if (!instruction) throw new Error("agentcast.open requires a non-empty {instruction}");
        const created = await requireOk(ctx, "POST", "/api/session", "*", CREATE_PERMISSIONS, { name: typeof input?.name === "string" ? input.name : "my-ax" });
        const data = (created.data ?? created) as Record<string, unknown>;
        const sessionId = String(data.sessionId ?? "");
        if (!sessionId) throw new Error("Create session did not return a session id");
        try {
          const status = await waitReady(ctx, sessionId);
          await requireOk(ctx, "POST", `/api/session/${sessionId}/wake`, sessionId, SESSION_PERMISSIONS);
          const instructed = await requireOk(ctx, "POST", `/api/session/${sessionId}/instruction`, sessionId, SESSION_PERMISSIONS, { instruction });
          const ticket = await requireOk(ctx, "POST", `/api/session/${sessionId}/view-ticket`, sessionId, SESSION_PERMISSIONS);
          const ticketUrl = String(ticket.ticketUrl ?? "");
          if (!ticketUrl.startsWith("https://") || ticketUrl.includes(".workers.dev") || !ticketUrl.includes("/ticket/")) {
            throw new Error("Viewer ticket URL is not a production ticket");
          }
          return {
            ok: true,
            sessionId,
            status: status.status ?? "ready",
            ticketUrl,
            instruction: instructed,
            transport: "http",
          };
        } catch (error) {
          await stopSessionQuietly(ctx, sessionId);
          throw error;
        }
      },
      instruct: async (input: any) => {
        const sessionId = String(input?.sessionId ?? "").trim();
        const instruction = String(input?.instruction ?? "").trim();
        if (!sessionId || !instruction) throw new Error("agentcast.instruct requires {sessionId, instruction}");
        return requireOk(ctx, "POST", `/api/session/${sessionId}/instruction`, sessionId, SESSION_PERMISSIONS, { instruction });
      },
      status: async (input: any) => {
        const sessionId = String(input?.sessionId ?? "").trim();
        if (!sessionId) throw new Error("agentcast.status requires {sessionId}");
        return requireOk(ctx, "GET", `/api/session/${sessionId}`, sessionId, SESSION_PERMISSIONS);
      },
      record: async (input: any) => {
        const sessionId = String(input?.sessionId ?? "").trim();
        if (!sessionId) throw new Error("agentcast.record requires {sessionId}");
        await requireOk(ctx, "POST", `/api/session/${sessionId}/wake`, sessionId, SESSION_PERMISSIONS);
        await requireOk(ctx, "POST", `/api/session/${sessionId}/network-har/start`, sessionId, SESSION_PERMISSIONS, {
          maxDurationMs: Number(input?.maxDurationMs ?? 8_000),
          maxEntries: Number(input?.maxEntries ?? 20),
        });
        const stopped = await requireOk(ctx, "POST", `/api/session/${sessionId}/network-har/stop`, sessionId, SESSION_PERMISSIONS);
        return { ok: true, sessionId, receipt: stopped.receipt ?? null };
      },
      stop: async (input: any) => {
        const sessionId = String(input?.sessionId ?? "").trim();
        if (!sessionId) throw new Error("agentcast.stop requires {sessionId}");
        await requireOk(ctx, "POST", `/api/session/${sessionId}/stop`, sessionId, SESSION_PERMISSIONS);
        return { ok: true, sessionId, stopped: true };
      },
    },
  };
}

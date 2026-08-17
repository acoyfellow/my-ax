import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { getSessionAgent } from "../agent-stub";
import { appendOwnedRunEvent, isValidSessionHarnessId, RunReceiptNotFoundError } from "../run-receipts";
import { JobService } from "../job-service";
import { readOwnerCheckIn } from "./check-in";
import { SavedRecipeService } from "../saved-recipes";
import { notifyOwner } from "../notify";
import { createDecision } from "./decisions";
import { getUserWorkspace } from "../workspace";
import { listWorkspace, readWorkspace, writeWorkspace } from "../workspace-mcp";
import { getOwnedArtifactRow, listOwnedArtifacts, readOwnedSvelteArtifact } from "../artifacts";
import { buildSessionTurnState } from "../session-turn";

const METHODS = ["list_sessions", "get_session", "entries", "inject", "session_state", "abort", "attention_list", "attention_acknowledge", "recipes_list", "recipes_delete", "recipes_run", "jobs_list", "jobs_create", "jobs_update", "jobs_pause", "jobs_resume", "jobs_run", "jobs_delete", "jobs_history", "workspace_list", "workspace_read", "workspace_write", "artifact_list", "artifact_get", "deployment"] as const;
type Method = typeof METHODS[number];
const MCP_NOTIFICATION_KINDS = ["session.update", "job.complete", "job.needs_input", "watch.fired", "deploy.gate", "recipe.approval"] as const;
type McpNotificationKind = typeof MCP_NOTIFICATION_KINDS[number];
const MCP_NOTIFICATION_KIND_SET: ReadonlySet<string> = new Set(MCP_NOTIFICATION_KINDS);

function isMcpNotificationKind(value: unknown): value is McpNotificationKind {
  return typeof value === "string" && MCP_NOTIFICATION_KIND_SET.has(value);
}

const TOOLS = [
  {
    name: "my_ax_code",
    description: "Execute bounded JavaScript orchestration against this owner's my-ax conversations and workspace. Preferred for multi-step inspection and steering. Available typed methods include listSessions, workspaceList, workspaceRead, getSession, entries, inject. No raw fetch or outbound network.",
    inputSchema: { type: "object", properties: { code: { type: "string", description: "JavaScript async arrow function using codemode.<method>(args)." } }, required: ["code"] },
  },
  {
    name: "my_ax_check_in",
    description: "Read one compact owner-scoped check-in composed from unread Attention, active jobs, and recent Run Receipts.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "my_ax_call",
    description: "Discover or directly invoke one narrow owner-scoped my-ax coordinator method. Use method=catalog for discovery; prefer my_ax_code for multi-step orchestration.",
    inputSchema: { type: "object", properties: { method: { type: "string", enum: ["catalog", ...METHODS] }, arguments: { type: "object" } }, required: ["method"] },
  },
  {
    name: "notify_owner",
    description: "Send an immediate one-off Web Push notification to this owner’s subscribed My AX apps and create a durable Attention entry. Use when the owner explicitly asks to be notified now. Delivery is restricted to the authenticated owner.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: MCP_NOTIFICATION_KINDS },
        title: { type: "string" },
        body: { type: "string" },
        href: { type: "string", description: "Optional same-origin My AX deep link." },
      },
      required: ["kind", "title", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_owner",
    description: "Create a durable owner decision (Approve/Reject or custom options), push it with lock-screen actions, and inject the answer back into sessionId. Use this instead of flattening a cockpit into notify_owner body text.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        question: { type: "string" },
        options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
        title: { type: "string" },
      },
      required: ["sessionId", "question", "options"],
      additionalProperties: false,
    },
  },
  {
    name: "my_ax_observe_connected_session",
    description: "Append one explicit connected-laptop delegated-agent session observation to an existing owner-scoped Run Receipt. The harness is any harness id the laptop reports, for example pi, vscode, codex or opencode. This records only the supplied observation; it does not discover sessions, attach to a TUI, mirror transcripts, synchronize a session, or add control authority.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        harness: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,31}$" },
        sessionId: { type: "string" },
        machineName: { type: "string" },
        label: { type: "string" },
        state: { type: "string" },
        note: { type: "string" },
      },
      required: ["runId", "harness", "sessionId"],
    },
  },
];

function rpc(id: unknown, result: unknown) { return { jsonrpc: "2.0", id: id ?? null, result }; }
function error(id: unknown, code: number, message: string) { return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }; }
function text(value: unknown) { return { content: [{ type: "text", text: JSON.stringify(value) }] }; }
function clamp(value: unknown, fallback: number, max: number) { return Math.max(1, Math.min(Number(value) || fallback, max)); }

type CoordinatorContext = { env: AppEnv["Bindings"]; get: (key: "identity") => AppEnv["Variables"]["identity"] };

async function ownedSession(c: CoordinatorContext, sessionId: string) {
  if (!sessionId) throw new Error("sessionId is required");
  const email = c.get("identity").email;
  const row = await c.env.DB.prepare("SELECT id, name, status, created_at, updated_at FROM sessions WHERE id = ? AND owner_email = ?").bind(sessionId, email).first();
  if (!row) throw new Error("session not found or not owned");
  return row;
}

async function coordinatorCall(c: CoordinatorContext, method: Method, args: Record<string, unknown>) {
  const email = c.get("identity").email.toLowerCase();
  if (method.startsWith("jobs_")) {
    const jobs = new JobService(c.env, email);
    const id = typeof args.id === "string" ? args.id : "";
    const input = { sessionId: args.sessionId as string | undefined, name: args.name as string | undefined, prompt: args.prompt as string | undefined, cadenceSecs: args.cadenceSecs as number | undefined };
    if (method === "jobs_list") {
      const status = typeof args.status === "string" && ["active", "paused"].includes(args.status) ? args.status as "active" | "paused" : undefined;
      return { jobs: await jobs.list(status) };
    }
    if (method === "jobs_create") return jobs.create(input, args.idempotencyKey as string | undefined);
    if (method === "jobs_update") return jobs.update(id, input);
    if (method === "jobs_pause") return jobs.setPaused(id, true);
    if (method === "jobs_resume") return jobs.setPaused(id, false);
    if (method === "jobs_run") return jobs.run(id, args.idempotencyKey as string | undefined);
    if (method === "jobs_delete") return jobs.delete(id);
    return { events: await jobs.history(id) };
  }
  if (method === "attention_list") {
    const limit = clamp(args.limit, 20, 100);
    const kind = typeof args.kind === "string" && args.kind.trim() ? args.kind.trim() : "";
    const onlyUnread = args.unread === true;
    const filters = ["owner_email = ?"];
    const params: unknown[] = [email];
    if (kind) {
      filters.push("kind = ?");
      params.push(kind);
    }
    if (onlyUnread) filters.push("seen_at IS NULL");
    const rows = await c.env.DB.prepare(`SELECT id, session_id, kind, title, body, href, created_at, seen_at FROM attention_items WHERE ${filters.join(" AND ")} ORDER BY created_at DESC LIMIT ?`).bind(...params, limit).all();
    return { items: rows.results ?? [] };
  }
  if (method === "attention_acknowledge") {
    const id = typeof args.id === "string" ? args.id.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("valid attention id is required");
    const item = await c.env.DB.prepare("SELECT id, title, href FROM attention_items WHERE id = ? AND owner_email = ?").bind(id, email).first<{ id: string; title: string; href: string }>();
    if (!item) throw new Error("attention item not found or not owned");
    await c.env.DB.prepare("UPDATE attention_items SET seen_at = COALESCE(seen_at, datetime('now')) WHERE id = ? AND owner_email = ?").bind(id, email).run();
    const runId = `run-glance-${crypto.randomUUID()}`;
    await c.env.DB.prepare("INSERT INTO runs(id, owner_email, status, title, task_summary, bounds_json, created_at, updated_at) VALUES (?, ?, 'completed', ?, ?, ?, datetime('now'), datetime('now'))").bind(runId, email, "Glance reaction", `Acknowledged: ${item.title}`, JSON.stringify({ surface: "glance", action: "attention_acknowledge", attentionId: id })).run();
    await c.env.DB.prepare("INSERT INTO run_events(run_id, event_id, owner_email, ts, actor_json, type, data_json, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)").bind(runId, `evt-${crypto.randomUUID()}`, email, new Date().toISOString(), JSON.stringify({ id: email, kind: "human", mode: "live" }), "attention.acknowledged", JSON.stringify({ attentionId: id, href: item.href, surface: "glance" })).run();
    return { acknowledged: true, id, receipt: `/api/runs/${runId}` };
  }
  if (method === "recipes_list") {
    const recipes = await new SavedRecipeService(c.env, email).list();
    return { recipes };
  }
  if (method === "recipes_delete") {
    const id = typeof args.id === "string" ? args.id.trim() : "";
    if (!id) throw new Error("recipe id is required");
    return new SavedRecipeService(c.env, email).delete(id);
  }
  if (method === "recipes_run") {
    const sessionId = typeof args.sessionId === "string" ? args.sessionId : "";
    await ownedSession(c, sessionId);
    const recipeId = typeof args.recipeId === "string" ? args.recipeId.trim() : "";
    if (!recipeId) throw new Error("recipeId is required");
    const input = args.input && typeof args.input === "object" && !Array.isArray(args.input) ? args.input as Record<string, unknown> : {};
    const callerCapabilities = Array.isArray(args.callerCapabilities) ? args.callerCapabilities.filter((capability): capability is string => typeof capability === "string") : undefined;
    const stub = await getSessionAgent(c.env, email, sessionId);
    await stub.seedIdentity(c.get("identity"));
    return stub.runSavedRecipe({ recipeId, input, callerCapabilities });
  }
  if (method === "workspace_list" || method === "workspace_read" || method === "workspace_write") {
    try {
      const { sandbox } = await getUserWorkspace(c.env, c.get("identity"));
      if (method === "workspace_list") {
        return await listWorkspace(sandbox, typeof args.path === "string" ? args.path : undefined, clamp(args.limit, 80, 200));
      }
      if (typeof args.path !== "string" || !args.path.trim()) throw new Error("path is required");
      if (method === "workspace_write") {
        if (typeof args.content !== "string") throw new Error("content is required");
        return await writeWorkspace(sandbox, args.path, args.content);
      }
      return await readWorkspace(sandbox, args.path, clamp(args.maxBytes, 8000, 32000));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { unavailable: true, error: message };
    }
  }
  if (method === "deployment") {
    const versionId = (c.env as { CF_VERSION_METADATA?: { id?: string; timestamp?: string } }).CF_VERSION_METADATA?.id ?? null;
    const versionTimestamp = (c.env as { CF_VERSION_METADATA?: { id?: string; timestamp?: string } }).CF_VERSION_METADATA?.timestamp ?? null;
    return { versionId, versionTimestamp, environment: (c.env as { ENVIRONMENT?: string }).ENVIRONMENT ?? null };
  }
  if (method === "artifact_list") {
    const artifacts = await listOwnedArtifacts(c.env, c.get("identity"), clamp(args.limit, 20, 100));
    return { artifacts };
  }
  if (method === "artifact_get") {
    const id = typeof args.id === "string" ? args.id.trim() : "";
    if (!id) throw new Error("id is required");
    const row = await getOwnedArtifactRow(c.env, c.get("identity"), id);
    if (!row) throw new Error("artifact not found or not owned");
    const manifest = await readOwnedSvelteArtifact(c.env, c.get("identity"), id);
    if (!manifest) throw new Error("artifact source not readable");
    return {
      id: manifest.id,
      title: manifest.title,
      sessionId: row.session_id,
      source: manifest.source,
      sourceHash: manifest.sourceHash,
      createdAt: manifest.createdAt,
    };
  }
  if (method === "list_sessions") {
    const limit = clamp(args.limit, 20, 100);
    const cursor = typeof args.cursor === "string" && args.cursor.trim() ? args.cursor.trim() : "";
    const sql = cursor
      ? "SELECT s.id, s.name, s.status, s.created_at, s.updated_at, (SELECT COUNT(*) FROM conversation_entries e WHERE e.session_id = s.id AND e.owner_email = s.owner_email) AS message_count, (SELECT substr(e.content, 1, 160) FROM conversation_entries e WHERE e.session_id = s.id AND e.owner_email = s.owner_email AND e.role = 'user' ORDER BY e.id ASC LIMIT 1) AS first_message FROM sessions s WHERE s.owner_email = ? AND s.updated_at < ? ORDER BY s.updated_at DESC LIMIT ?"
      : "SELECT s.id, s.name, s.status, s.created_at, s.updated_at, (SELECT COUNT(*) FROM conversation_entries e WHERE e.session_id = s.id AND e.owner_email = s.owner_email) AS message_count, (SELECT substr(e.content, 1, 160) FROM conversation_entries e WHERE e.session_id = s.id AND e.owner_email = s.owner_email AND e.role = 'user' ORDER BY e.id ASC LIMIT 1) AS first_message FROM sessions s WHERE s.owner_email = ? ORDER BY s.updated_at DESC LIMIT ?";
    const rows = cursor
      ? await c.env.DB.prepare(sql).bind(email, cursor, limit + 1).all()
      : await c.env.DB.prepare(sql).bind(email, limit + 1).all();
    const results = (rows.results ?? []) as Array<Record<string, unknown>>;
    const hasMore = results.length > limit;
    const page = hasMore ? results.slice(0, limit) : results;
    const last = page[page.length - 1];
    return {
      sessions: page.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        messageCount: Number(row.message_count) || 0,
        firstMessage: typeof row.first_message === "string" ? row.first_message : null,
      })),
      hasMore,
      cursor: hasMore && last && typeof last.updated_at === "string" ? last.updated_at : null,
    };
  }
  const sessionId = typeof args.sessionId === "string" ? args.sessionId : "";
  const session = await ownedSession(c, sessionId);
  if (method === "get_session") return { session };
  if (method === "session_state" || method === "abort") {
    const stub = await getSessionAgent(c.env, email, sessionId);
    await stub.seedIdentity(c.get("identity"));
    if (method === "session_state") {
      const live = await stub.sessionTurnState();
      return buildSessionTurnState({
        sessionId,
        sessionStatus: typeof live.sessionStatus === "string" ? live.sessionStatus : String(session.status ?? "active"),
        requestId: live.requestId,
        updatedAt: typeof session.updated_at === "string" ? session.updated_at : null,
      });
    }
    return stub.abortActiveTurn();
  }
  if (method === "entries") {
    const after = Math.max(0, Number(args.after) || 0);
    const limit = clamp(args.limit, 20, 100);
    const rows = await c.env.DB.prepare("SELECT id, ts, role, tool, is_error, content, meta_json FROM conversation_entries WHERE session_id = ? AND owner_email = ? AND id > ? ORDER BY id ASC LIMIT ?").bind(sessionId, email, after, limit).all();
    return { sessionId, entries: rows.results ?? [] };
  }
  const content = typeof args.content === "string" ? args.content.trim() : "";
  if (!content) throw new Error("content is required");
  const stub = await getSessionAgent(c.env, email, sessionId);
  await stub.seedIdentity(c.get("identity"));
  await stub.injectUserMessage({ content, clientMsgId: `mcp:${crypto.randomUUID()}` });
  await c.env.DB.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ? AND owner_email = ?").bind(sessionId, email).run();
  return { sessionId, injected: true };
}

async function askOwner(c: CoordinatorContext, args: Record<string, unknown>) {
  const sessionId = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
  const question = typeof args.question === "string" ? args.question.trim() : "";
  const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : "Needs your decision";
  const options = Array.isArray(args.options) ? args.options.map((option) => String(option).trim()).filter(Boolean).slice(0, 6) : [];
  if (!sessionId) throw new Error("sessionId is required");
  if (!question) throw new Error("question is required");
  if (options.length < 2) throw new Error("at least two options are required");
  await ownedSession(c, sessionId);
  const email = c.get("identity").email.toLowerCase();
  const decision = await createDecision(c.env, email, sessionId, question, options);
  const receipt = await notifyOwner(c.env, email, {
    kind: "job.needs_input",
    title,
    body: question.slice(0, 300),
    href: decision.href,
    sessionId,
    decision: { id: decision.id, options },
  });
  return { ok: true, awaiting: true, decisionId: decision.id, href: decision.href, options, reused: decision.reused, receipt };
}

async function observeConnectedSession(c: CoordinatorContext, args: Record<string, unknown>) {
  const runId = typeof args.runId === "string" ? args.runId.trim() : "";
  const harness = typeof args.harness === "string" ? args.harness.trim().toLowerCase() : "";
  const sessionId = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
  if (!runId) throw new Error("runId is required");
  if (!isValidSessionHarnessId(harness)) throw new Error("harness must be a harness id, for example pi, codex or opencode");
  if (!sessionId) throw new Error("sessionId is required");
  return appendOwnedRunEvent(c, runId, {
    actor: { id: `machinectl:${typeof args.machineName === "string" && args.machineName.trim() ? args.machineName.trim() : "connected-laptop"}`, kind: "machinectl", mode: "live" },
    type: "machinectl.observation.captured",
    data: {
      observation: "connected-laptop-session",
      machineName: typeof args.machineName === "string" && args.machineName.trim() ? args.machineName.trim() : null,
      session: {
        harness,
        id: sessionId,
        ...(typeof args.label === "string" && args.label.trim() ? { label: args.label.trim() } : {}),
        ...(typeof args.state === "string" && args.state.trim() ? { state: args.state.trim() } : {}),
      },
      ...(typeof args.note === "string" && args.note.trim() ? { note: args.note.trim() } : {}),
      explicit: true,
      noTranscript: true,
      noAttach: true,
    },
  });
}

const CODE_METHODS: Record<string, Method> = {
  listSessions: "list_sessions",
  getSession: "get_session",
  entries: "entries",
  inject: "inject",
  attentionList: "attention_list",
  attentionAcknowledge: "attention_acknowledge",
  recipesList: "recipes_list",
  recipesDelete: "recipes_delete",
  recipesRun: "recipes_run",
  jobsList: "jobs_list",
  jobsCreate: "jobs_create",
  jobsUpdate: "jobs_update",
  jobsPause: "jobs_pause",
  jobsResume: "jobs_resume",
  jobsRun: "jobs_run",
  jobsDelete: "jobs_delete",
  jobsHistory: "jobs_history",
  workspaceList: "workspace_list",
  workspaceRead: "workspace_read",
  workspaceWrite: "workspace_write",
  sessionState: "session_state",
  abort: "abort",
  artifactList: "artifact_list",
  artifactGet: "artifact_get",
  deployment: "deployment",
};

function objectArgs(input: unknown): Record<string, unknown> {
  return (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
}

function coordinatorCodeFns(c: CoordinatorContext) {
  return Object.fromEntries(
    Object.entries(CODE_METHODS).map(([name, method]) => [name, (input: unknown) => coordinatorCall(c, method, objectArgs(input))]),
  );
}

const CODE_TYPES = `declare const codemode: {
  listSessions(args?: { limit?: number }): Promise<unknown>;
  getSession(args: { sessionId: string }): Promise<unknown>;
  entries(args: { sessionId: string; after?: number; limit?: number }): Promise<unknown>;
  inject(args: { sessionId: string; content: string }): Promise<unknown>;
  attentionList(args?: { limit?: number }): Promise<unknown>;
  attentionAcknowledge(args: { id: string }): Promise<unknown>;
  recipesList(args?: {}): Promise<unknown>;
  recipesDelete(args: { id: string }): Promise<unknown>;
  recipesRun(args: { sessionId: string; recipeId: string; input?: Record<string, unknown>; callerCapabilities?: string[] }): Promise<unknown>;
  jobsList(args?: {}): Promise<unknown>;
  jobsCreate(args: { sessionId: string; name: string; prompt: string; cadenceSecs: number; idempotencyKey?: string }): Promise<unknown>;
  jobsUpdate(args: { id: string; sessionId?: string; name?: string; prompt?: string; cadenceSecs?: number }): Promise<unknown>;
  jobsPause(args: { id: string }): Promise<unknown>; jobsResume(args: { id: string }): Promise<unknown>;
  jobsRun(args: { id: string; idempotencyKey?: string }): Promise<unknown>; jobsDelete(args: { id: string }): Promise<unknown>;
  jobsHistory(args: { id: string }): Promise<unknown>;
  workspaceList(args?: { path?: string; limit?: number }): Promise<unknown>;
  workspaceRead(args: { path: string; maxBytes?: number }): Promise<unknown>;
  workspaceWrite(args: { path: string; content: string }): Promise<unknown>;
  sessionState(args: { sessionId: string }): Promise<unknown>;
  abort(args: { sessionId: string }): Promise<unknown>;
  artifactList(args?: { limit?: number }): Promise<unknown>;
  artifactGet(args: { id: string }): Promise<unknown>;
  deployment(): Promise<unknown>;
};`;

/** Owner-scoped coordinator MCP. Cloudflare Access remains the only auth boundary. */
export function registerMcpRoutes(app: Hono<AppEnv>) {
  app.post("/api/mcp", async (c) => {
    const req = await c.req.json<{ id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }>().catch(() => null);
    if (!req?.method) return c.json(error(null, -32600, "Invalid request"), 400);
    if (req.method === "initialize") return c.json(rpc(req.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "my-ax", version: "0.2" } }));
    if (req.method === "notifications/initialized") return new Response(null, { status: 204 });
    if (req.method === "ping") return c.json(rpc(req.id, {}));
    if (req.method === "tools/list") return c.json(rpc(req.id, { tools: TOOLS }));
    if (req.method !== "tools/call") return c.json(error(req.id, -32601, "Method not found"), 404);
    const name = req.params?.name;
    const args = req.params?.arguments ?? {};
    try {
      if (name === "my_ax_check_in") {
        return c.json(rpc(req.id, text(await readOwnerCheckIn(c.env, c.get("identity").email))));
      }
      if (name === "my_ax_call") {
        const method = args.method;
        if (method === "catalog") return c.json(rpc(req.id, text({ methods: METHODS, receiptTools: ["my_ax_observe_connected_session"], notificationTools: ["notify_owner"], checkInTool: "my_ax_check_in" })));
        if (typeof method !== "string" || !METHODS.includes(method as Method)) throw new Error("unknown coordinator method");
        return c.json(rpc(req.id, text(await coordinatorCall(c, method as Method, (args.arguments as Record<string, unknown> | undefined) ?? {}))));
      }
      if (name === "notify_owner") {
        const kind = args.kind;
        const title = typeof args.title === "string" ? args.title.trim() : "";
        const body = typeof args.body === "string" ? args.body.trim() : "";
        if (!isMcpNotificationKind(kind)) throw new Error("valid notification kind is required");
        if (!title) throw new Error("title is required");
        if (!body) throw new Error("body is required");
        const receipt = await notifyOwner(c.env, c.get("identity").email, {
          kind,
          title,
          body,
          href: typeof args.href === "string" ? args.href : undefined,
        });
        const delivered = receipt.delivered > 0 && receipt.failed === 0;
        return c.json(rpc(req.id, { ...text({ ok: delivered, ...receipt }), ...(delivered ? {} : { isError: true }) }));
      }
      if (name === "ask_owner") {
        return c.json(rpc(req.id, text(await askOwner(c, args))));
      }
      if (name === "my_ax_observe_connected_session") {
        try {
          return c.json(rpc(req.id, text(await observeConnectedSession(c, args))));
        } catch (error) {
          if (error instanceof RunReceiptNotFoundError) return c.json(rpc(req.id, { ...text({ error: error.message }), isError: true }));
          throw error;
        }
      }
      if (name === "my_ax_code") {
        const code = typeof args.code === "string" ? args.code : "";
        if (!code) throw new Error("code is required");
        const executor = new DynamicWorkerExecutor({ loader: c.env.LOADER, globalOutbound: null, timeout: 30_000 });
        const execution = await executor.execute(code, [{ name: "codemode", fns: coordinatorCodeFns(c) }]);
        if (execution.error) return c.json(rpc(req.id, { ...text({ ok: false, error: execution.error, available: CODE_TYPES }), isError: true }));
        return c.json(rpc(req.id, text({ ok: true, result: execution.result, logs: execution.logs ?? [], availableMethods: METHODS })));
      }
      throw new Error("unknown tool");
    } catch (err) {
      return c.json(rpc(req.id, { ...text({ error: err instanceof Error ? err.message : String(err) }), isError: true }));
    }
  });
}

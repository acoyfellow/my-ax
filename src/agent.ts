import { Think } from "@cloudflare/think";
import { Session } from "agents/experimental/memory/session";
import { generateText, stepCountIs, type ModelMessage, type StopCondition, type ToolSet, type UIMessage } from "ai";
import { createCompactFunction } from "agents/experimental/memory/utils";
import type { ChatRecoveryExhaustedContext, ChatResponseResult, ToolCallResultContext } from "@cloudflare/think";
import type { Env } from "./types";
import { resolveMyAxModel } from "./llm";
import { defaultModelId, findModel } from "./models";
import type { AccessIdentity } from "./auth";
import { SandboxThinkWorkspace } from "./think-workspace";
import { createThinkTools } from "./tools";
import type { ToolContext } from "./types";
import { getUserWorkspace, snapshotUserWorkspace } from "./workspace";
import { WORKSPACE_HOME } from "./workspace";
import { notifyOwner } from "./notify";
import { completeRecurringJobRun, recurringJobIdFromClientMessageId } from "./recurring-job-run";
import { computeNextRun, runJobNow, scheduledJobRunPrompt, type JobRow } from "./jobs";
import { deriveSessionTitle } from "./session-title";
import { recordCycleCost, nextCycleIndex, type CycleCostUsage } from "./cycle-costs";
import { recordRecoveryExhaustion } from "./recovery-exhaustion";
import { shouldSendCompletionNotification, visibleAssistantContent, visibleCompletionNotificationBody } from "./turn-visible-receipt";
import { createMyAxBrowserTools } from "./browser-tools";
import { limitToolSetOutput } from "./tool-output-limit";
import { appendConversationLog, logAssistantMessage, logToolCall, logUserMessage } from "./conversation-log";
import { assistantBackfillCandidates } from "./assistant-backfill";
import { sanitizeToolCallIds } from "./tool-id-sanitize";
import { readUploadBytes } from "./uploads";
import { createSvelteArtifact } from "./artifacts";
import { createAudioMessage } from "./audio-messages";
import type { Attachment } from "./types";
import { makeOAuthClientStore } from "./oauth-store";
import { getBuiltinConnectors } from "./connectors";
import { createOfficialMcpCodeModeTool } from "./mcp-code-mode";
import { createDelegateManyTool, ReadOnlyDelegateAgent, type DelegateResult } from "./delegate-many";
import { delegateCompletionNotification } from "./delegate-receipt";
import { SavedRecipeError, SavedRecipeService, recipeRunTitle, savedRecipeExecutionCode, validateRecipeRunInput } from "./saved-recipes";
import { executeWorkCode } from "./work-tools";
import { resolveBridgeOrigin } from "./bridge-origin";
import { reusableToolApprovalMode } from "./reusable-tool-preferences";
import type { ReusableToolCandidate } from "./reusable-tool-candidate";
import { codemodeExecutionIdForRecipe, listSnippetsDualRead, projectSavedRecipe } from "./cm-snippets";
import { intersectCapabilities } from "./capability-intersect";
import { errorConversationMeta } from "./error-meta";
import { recipeApprovalDecision, shouldPersistSuggestedRecipe } from "./recipe-approval-policy";

// Generic system prompt for the public/self-host engine. Users connect
// their own MCPs via Settings → Connectors (the BYO MCP path) and the
// agent discovers their tools at runtime; the model learns about them
// from the native MCP tool descriptions, not from this prompt.
const PUBLIC_SYSTEM = `You are the my-ax Agent, a research and analysis assistant.

## Tools

Computer work is exposed through two tools:
- work_search discovers capabilities and helps choose the right place: workspace.* is the persistent My AX Workspace, machine.* is the user's connected physical machine and authenticated local state, and cloudbox.* is clean bounded repository work with receipts.
- work_code executes one bounded async JavaScript function over those exact namespaces. The function receives ctx with { workspace, machine, cloudbox, codemode }, and the same namespaces are also available as globals, so both async (ctx) => ctx.machine.shell(...) and async () => machine.shell(...) are valid. Prefer My AX Workspace for conversation-adjacent files and transforms, My Machine for current local checkouts/authenticated state/cmux, and Cloudbox for clean clones, isolated verification, continuation without the laptop, and proof-producing runs. A codemode-shaped namespace is also exposed as codemode.search(query), codemode.describe(name), and codemode.run(name, input); use codemode.run to invoke an owner-approved reusable tool when an enabled reusable tool clearly matches the task. Reusable tools are projected from the owner-curated D1 compatibility store into a codemode-native shape with provenance "projected" and a synthetic execution id (cm_synth_<recipeId>); no native CodemodeRuntime promotion path is live yet, so every reusable tool today carries projected provenance. Reusable-tool runs create receipts that carry the codemode execution id and appear in Check-in. No publication authority is available inside work_code. Reusable-tool candidates: when — and only when — the code you write is broadly reusable across future tasks (not a one-off shell command, not throwaway scratch, not tied to today's specific paths or values), begin the code with exactly one comment "// reusable-tool: <short meaningful name>". The owner controls whether marked candidates wait as Pending or are enabled automatically in Settings → Reusable tools; unmarked runs stay inline forever. Do not mark ad-hoc shell/exec commands, quick file peeks, or scripts you would not want the owner to see enabled tomorrow.

Other product tools:
- Think's native read/write/edit/list/find/grep/delete tools operate on the same persistent My AX Workspace for simple one-step file operations. Use work_code when composition, processes, My Machine, or Cloudbox are needed.
- browser_open opens a public web page in a real headless browser session with replay recording. Use it for public websites and rendered UI checks; do not claim authenticated browser access.
- create_svelte_artifact creates a durable interactive Svelte 5 artifact attached to this conversation when the user asks for a widget, visualization, dashboard, calculator, or interactive UI. Provide complete self-contained Svelte source with no external imports.
- search_conversations searches earlier conversation memory indexed in D1 full-text search. When the user asks about previous discussions, use this — don't grep workspace files for chat memory.
- ask_user asks the owner one multiple-choice question and pauses for their answer. Use it when you genuinely need a human decision (approval, a choice between options, missing direction) before continuing — especially when the user may be away. It pushes a notification; after calling it, stop and wait. The choice returns as a new user message.
- Any MCP servers the user has connected (Settings → Connectors) appear as native tools. Their names come from the MCP server's tools/list. If an MCP server needs re-authorization, tell the user to open Settings → Connectors and re-authorize, then STOP.
- When mcp_code_mode is present, it contains only operator-approved read/query methods. Prefer it for multi-step search, pagination, filtering, and joins. Use native MCP tools for writes, approvals, or one simple call.

## Memory & history

Conversation memory is indexed in D1 full-text search; the model can recall it with search_conversations. Don't grep workspace files for chat memory and don't claim you have no memory of earlier conversations.

## Identity & auth

The user is authenticated upstream (typically Cloudflare Access). Their email is in the tool context — you can refer to them by their first name. Upstream credentials for MCP servers are brokered by the worker; you never see them.

## Style

- Be thorough but concise. Show your work via tool calls — the user sees them.
- When exploring an API or filesystem, call/look first, theorize second.
- When unsure, reason before acting and verify with tools. Don't guess.
- Prefer acting over asking, but when a real decision genuinely needs the human, use ask_user rather than stalling or guessing.
- Voice in messages: direct, lowercase-first if it reads naturally, no exclamation marks unless something is genuinely surprising.`;

type MyAgentConfig = {
  identity?: AccessIdentity;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
};

// Resolve the public origin used to build connector-OAuth callback URLs.
// LENIENT by design: a blank/invalid BRIDGE_BASE_URL returns "" instead of
// throwing, so pure work_code (which never touches connector OAuth) is not
// starved by missing config. The connector-OAuth path validates the origin at
// the point of use via requireBridgeOrigin(). (Previously this threw at
// tool-context build, so EVERY work_code run — even pure ones — errored when
// BRIDGE_BASE_URL was empty, starving the whole snippet-promotion flywheel.)
function resolveWorkerOrigin(env: Env): string {
  return resolveBridgeOrigin(env.BRIDGE_BASE_URL) ?? "";
}

// Require a valid origin — call this only where a connector OAuth flow actually
// needs a public callback URL, never at generic context build.
export function requireBridgeOrigin(env: Env): string {
  const origin = resolveBridgeOrigin(env.BRIDGE_BASE_URL);
  if (!origin) throw new Error("BRIDGE_BASE_URL must be an absolute public URL before connector OAuth tools can run");
  return origin;
}

type RecurringPromptPayload = {
  jobId: string;
  ownerEmail: string;
  prompt: string;
};

function textParts(message: UIMessage): string {
  return message.parts.filter((part) => part.type === "text").map((part) => part.text).join("");
}
function reasoningParts(message: UIMessage): string {
  return message.parts.filter((part) => part.type === "reasoning").map((part) => part.text).join("");
}
function attachmentParts(message: UIMessage): Attachment[] {
  return message.parts.flatMap((part) => {
    if (part.type !== "data-attachment") return [];
    const data = (part as { data?: Attachment }).data;
    return data && typeof data.key === "string" ? [data] : [];
  });
}

/**
 * Production-native my-ax agent powered by Cloudflare Think.
 * Think owns chat persistence, protocol streaming, recovery, and durable submissions;
 * my-ax supplies its Cloud Computer workspace, connectors, memory mirror, and push channel.
 */
/** Tool names that NEVER mutate /home/user. Anything outside this set is
 *  treated as potentially-writing; a successful call sets the per-turn
 *  dirty flag that triggers a single workspace snapshot at turn end. */
const READ_ONLY_TOOLS = new Set<string>([
  "read_file",
  "work_search",
  "search_files",
  "list_directory",
  "process_status",
  "process_logs",
  "process_cancel",
  "search_conversations",
  "notify_owner",
  "create_svelte_artifact",
  "list_preview_services",
  "preview_service",
  "close_preview_service",
  "think",
]);

export class MyAgent extends Think<Env> {
  maxSteps = 25;
  maxConcurrentAgentTools = 2;
  sendReasoning = true;
  override chatRecovery = {
    maxAttempts: 6,
    noProgressTimeoutMs: 300_000,
    terminalMessage: "This turn was interrupted after recovery was exhausted. Please try again.",
    onExhausted: (ctx: ChatRecoveryExhaustedContext) => this.terminalizeExhaustedRecovery(ctx),
  };
  // v0.17 stream-stall watchdog. Must exceed our slowest tool execution or it
  // would abort healthy long turns; my-ax runs slow sandbox/browser/agent-tool
  // work, so this is set wide (5m) to catch only genuinely hung transports.
  // With chatRecovery enabled, a stall routes into the same bounded-recovery
  // machinery a deploy/eviction uses. Raise per-turn via beforeTurn's
  // TurnConfig.chatStreamStallTimeoutMs for turns with known-slow tools.
  override chatStreamStallTimeoutMs = 300_000;

  /** Per-turn flag: set when a successful tool call may have written under
   *  /home/user. Drives a single snapshotUserWorkspace() in onChatResponse.
   *  Reset at the start of every turn via onChatResponse itself (after we
   *  consume it). The DO is single-threaded for a session so there's no
   *  race between turns. */
  private dirtyFsThisTurn = false;
  private notifiedOwnerThisTurn = false;
  // page.* codemode connector: in-flight page_call requests keyed by requestId,
  // resolved when the live client replies with a page_result frame (onMessage).
  private pendingPageCalls = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private cycleStepUsage: Array<{ usage?: { inputTokens?: number | null; outputTokens?: number | null; totalTokens?: number | null }; finishReason?: string }> = [];
  private recipesUsedThisTurn: unknown[] = [];
  private recipesSavedThisTurn: unknown[] = [];
  /** Native agents MCP registrations are per-session DO, but bearer tokens
   * remain per-user in OAuthClientDO. Lazily hydrate once per isolate and
   * expose each discovered MCP tool directly to Think. */
  // Keep the generic Think workspace bash tool off: my-ax already exposes
  // real shell/process tools for its remote Sandbox-backed /home/user.
  workspaceBash = false;
  override workspace = new SandboxThinkWorkspace(this.env, () => this.getConfig<MyAgentConfig>()?.identity);

  seedIdentity(identity: AccessIdentity) {
    this.configure<MyAgentConfig>({ ...(this.getConfig<MyAgentConfig>() ?? {}), identity });
  }

  /** Persist the model the UI currently has selected so non-composer turns
   *  (voice) use the same model as typed chat. Ignores unknown ids. */
  setSessionModel(model: string, reasoningEffort?: string) {
    if (!findModel(model)) return { ok: false, model: this.getConfig<MyAgentConfig>()?.model ?? defaultModelId(this.env) };
    const current = this.getConfig<MyAgentConfig>() ?? {};
    const effort = reasoningEffort === "low" || reasoningEffort === "medium" || reasoningEffort === "high" ? reasoningEffort : undefined;
    this.configure<MyAgentConfig>({ ...current, model, ...(effort ? { reasoningEffort: effort } : {}) });
    return { ok: true, model };
  }

  async importLegacyMessages(messages: UIMessage[]) {
    if ((await this.getMessages()).length > 0) return { imported: 0, skipped: true };
    for (const message of messages) await this.session.appendMessage(message);
    return { imported: messages.length, skipped: false };
  }

  async forkHistoryAt(messageId: string): Promise<UIMessage[]> {
    if (!messageId) throw new Error("messageId is required");
    const history = await this.session.getHistory(messageId) as UIMessage[];
    if (!history.length || history.at(-1)?.id !== messageId) throw new Error("Fork point was not found in this conversation.");
    const hasPendingTool = history.some((message) => message.parts.some((part) => part.type.startsWith("tool-") && !["output-available", "output-error", "output-denied"].includes((part as { state?: string }).state ?? "")));
    if (hasPendingTool) throw new Error("Fork from the previous completed message instead; this path contains an unresolved tool call.");
    return history;
  }

  async seedForkHistory(identity: AccessIdentity, messages: UIMessage[]): Promise<void> {
    this.seedIdentity(identity);
    if (this.messages.length) throw new Error("Fork target is not empty.");
    for (const message of messages) await this.appendMessageToHistory(message);
  }

  async injectUserMessage(body: { content?: string; clientMsgId?: string; attachments?: Attachment[] }) {
    const identity = this.getConfig<MyAgentConfig>()?.identity;
    if (!identity) throw new Error("session identity not seeded");
    const content = (body.content ?? "").trim();
    if (!content) throw new Error("content must be non-empty");
    const attachments = (body.attachments ?? []).filter((attachment) => attachment.kind === "image");
    return this.runTurn({
      mode: "submit",
      idempotencyKey: body.clientMsgId,
      input: [
        {
          id: body.clientMsgId ?? crypto.randomUUID(),
          role: "user",
          parts: [
            { type: "text", text: content },
            ...attachments.flatMap((attachment) => [
              { type: "data-attachment" as `data-${string}`, data: attachment },
              { type: "file" as const, url: `/api/uploads/${encodeURIComponent(attachment.key)}`, mediaType: attachment.mime, filename: attachment.name },
            ]),
          ],
        },
      ],
    });
  }

  async notifyDelegateManyComplete(results: DelegateResult[]) {
    const identity = this.getConfig<MyAgentConfig>()?.identity;
    if (!identity?.email || results.length === 0) return;
    await notifyOwner(this.env, identity.email, delegateCompletionNotification({ sessionId: this.name, results }));
  }

  async runSavedRecipe(body: { recipeId?: string; input?: Record<string, unknown>; callerCapabilities?: string[] }) {
    const identity = this.getConfig<MyAgentConfig>()?.identity;
    if (!identity?.email) throw new Error("session identity not seeded");
    const recipeId = body.recipeId?.trim();
    if (!recipeId) throw new Error("recipeId is required");
    const recipe = await new SavedRecipeService(this.env, identity.email).requireEnabled(recipeId);
    const runInput = validateRecipeRunInput(body.input ?? {}, JSON.parse(recipe.input_schema_json));
    // Capability intersection (Round 02 objection #7): a snippet/recipe run
    // must never widen the caller's capability bounds. When the caller passes
    // its own grant set, use the intersection; otherwise the recipe's
    // declared capabilities apply unchanged.
    const declaredCapabilities = JSON.parse(recipe.capabilities_json) as string[];
    const effectiveCapabilities = intersectCapabilities(body.callerCapabilities, declaredCapabilities);
    // The synthetic-or-real codemode execution id for receipts. See
    // cm-snippets.ts for the projection/dual-read seam.
    const codemodeExecutionId = await codemodeExecutionIdForRecipe(this.env, { id: recipe.id, name: recipe.name, owner_email: identity.email });
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.env.DB.prepare(`INSERT INTO runs (id, owner_email, session_id, status, title, task_summary, bounds_json, created_at, updated_at)
      VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?)`).bind(
        runId,
        identity.email.toLowerCase(),
        this.name,
        recipeRunTitle(recipe),
        recipe.description,
        JSON.stringify({
          kind: "saved_recipe",
          recipeId: recipe.id,
          declaredCapabilities,
          effectiveCapabilities,
          codemodeExecutionId,
        }),
        now,
        now,
      ).run();
    const actor = JSON.stringify({ id: "my-ax", kind: "coordinator", mode: "live" });
    await this.env.DB.prepare(`INSERT INTO run_events (run_id, event_id, owner_email, ts, actor_json, type, data_json, evidence_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        runId,
        `evt-start-${crypto.randomUUID()}`,
        identity.email.toLowerCase(),
        now,
        actor,
        "recipe.started",
        JSON.stringify({
          recipeId: recipe.id,
          name: recipe.name,
          input: runInput,
          codemodeExecutionId,
          declaredCapabilities,
          effectiveCapabilities,
        }),
        null,
      ).run();
    const code = savedRecipeExecutionCode(recipe.code, runInput);
    const result = await executeWorkCode(code, {
      ...this.buildToolContext(),
      allowedWorkCapabilities: effectiveCapabilities,
      exposeSavedRecipes: false,
    });
    const terminal = result.ok ? "completed" : "failed";
    await this.env.DB.prepare(`INSERT INTO run_events (run_id, event_id, owner_email, ts, actor_json, type, data_json, evidence_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        runId,
        `evt-${terminal}-${crypto.randomUUID()}`,
        identity.email.toLowerCase(),
        new Date().toISOString(),
        actor,
        `recipe.${terminal}`,
        JSON.stringify({
          recipeId: recipe.id,
          name: recipe.name,
          ok: result.ok,
          codemodeExecutionId,
        }),
        JSON.stringify(result),
      ).run();
    await this.env.DB.prepare("UPDATE runs SET status = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ?").bind(terminal, runId, identity.email.toLowerCase()).run();
    // Refresh the cm_snippets projection so a successful run keeps the
    // dual-read store in sync with the latest recipe code. Fail-soft: a
    // projection write must never break a successful recipe run.
    if (result.ok) {
      await projectSavedRecipe(this.env, recipe).catch((error) => console.error("cm_snippet_projection_failed", { recipeId: recipe.id, err: error instanceof Error ? error.message : String(error) }));
    }
    return { runId, recipe: { id: recipe.id, name: recipe.name }, execution: result, codemodeExecutionId, declaredCapabilities, effectiveCapabilities };
  }

  async scheduleRecurringPrompt(payload: RecurringPromptPayload & { cadenceSecs: number }) {
    return this.scheduleEvery(payload.cadenceSecs, "runRecurringPrompt", {
      jobId: payload.jobId,
      ownerEmail: payload.ownerEmail,
      prompt: payload.prompt,
    });
  }

  async cancelRecurringPrompt(scheduleId: string) {
    return this.cancelSchedule(scheduleId);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Internal callers (jobs/MCP) reach the DO by stub.fetch rather than the
    // Agents WebSocket router. Initialize Think's Session/stream machinery
    // before using submitMessages on that path.
    if (
      url.pathname === "/seed-identity" ||
      url.pathname === "/inject-user-message" ||
      url.pathname === "/schedule-recurring-prompt" ||
      url.pathname === "/cancel-recurring-prompt"
    ) {
      await this.onStart();
    }
    if (url.pathname === "/seed-identity") {
      const body = await request.json<{ identity?: AccessIdentity }>();
      if (!body.identity?.email) return Response.json({ ok: false, error: "identity required" }, { status: 400 });
      this.seedIdentity(body.identity);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/inject-user-message") {
      try {
        const result = await this.injectUserMessage(await request.json());
        return Response.json({ ok: true, result });
      } catch (err) {
        return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 400 });
      }
    }
    if (url.pathname === "/schedule-recurring-prompt") {
      const payload = await request.json<RecurringPromptPayload & { cadenceSecs?: number }>();
      if (!payload.jobId || !payload.ownerEmail || !payload.prompt || !Number.isInteger(payload.cadenceSecs)) {
        return Response.json({ ok: false, error: "jobId, ownerEmail, prompt, cadenceSecs required" }, { status: 400 });
      }
      const schedule = await this.scheduleRecurringPrompt({ ...payload, cadenceSecs: payload.cadenceSecs! });
      return Response.json({ ok: true, schedule });
    }
    if (url.pathname === "/cancel-recurring-prompt") {
      const body = await request.json<{ scheduleId?: string }>();
      return Response.json({ ok: !!body.scheduleId && await this.cancelRecurringPrompt(body.scheduleId) });
    }
    return super.fetch(request);
  }

  /** Native agents alarm callback for recurring prompt jobs. */
  async runRecurringPrompt(payload: RecurringPromptPayload) {
    const identity = this.identity() ?? { email: payload.ownerEmail, sub: `job:${payload.ownerEmail}` };
    this.configure<MyAgentConfig>({ ...(this.getConfig<MyAgentConfig>() ?? {}), identity });
    const now = new Date();
    const ownerEmail = payload.ownerEmail.toLowerCase();
    const row = await this.env.DB.prepare("SELECT id, owner_email, session_id, thread_mode, name, prompt, cadence_secs, status, next_run_at, last_run_at, last_error, schedule_id, created_at, updated_at FROM jobs WHERE id = ? AND owner_email = ?")
      .bind(payload.jobId, ownerEmail).first<JobRow>().catch(() => null);
    if (row?.status === "paused") return;
    if (row?.thread_mode === "new_session_per_run") {
      const result = await runJobNow(this.env, row, now);
      if (!result.ok) throw new Error(result.error ?? "recurring job failed");
      return;
    }
    let error: string | null = null;
    try {
      await this.runTurn({
        mode: "submit",
        idempotencyKey: `job:${payload.jobId}:${now.getTime()}`,
        input: [
          { id: `job:${payload.jobId}:${now.getTime()}`, role: "user", parts: [{ type: "text", text: scheduledJobRunPrompt(payload.prompt) }] },
        ],
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    await completeRecurringJobRun(this.env, {
      jobId: payload.jobId,
      ownerEmail: payload.ownerEmail,
      sessionId: this.name,
      sourceSessionId: row?.session_id ?? this.name,
      threadMode: row?.thread_mode ?? "same_session",
      ranAt: now,
      nextRunAt: row ? computeNextRun(now, row.cadence_secs) : null,
      jobName: row?.name ?? null,
      error,
    });
    if (error) throw new Error(error);
  }

  private async completeInjectedRecurringJobRun(result: ChatResponseResult): Promise<void> {
    if (result.status !== "completed" && result.status !== "error") return;
    const identity = this.identity();
    if (!identity) return;
    const lastUser = [...this.messages].reverse().find((message) => message.role === "user");
    const jobId = recurringJobIdFromClientMessageId(lastUser?.id);
    if (!jobId) return;
    const ownerEmail = identity.email.toLowerCase();
    const row = await this.env.DB.prepare("SELECT id, owner_email, session_id, thread_mode, name, prompt, cadence_secs, status, next_run_at, last_run_at, last_error, schedule_id, created_at, updated_at FROM jobs WHERE id = ? AND owner_email = ?")
      .bind(jobId, ownerEmail).first<JobRow>().catch(() => null);
    if (!row || row.thread_mode !== "new_session_per_run") return;
    await completeRecurringJobRun(this.env, {
      jobId: row.id,
      ownerEmail,
      sessionId: this.name,
      sourceSessionId: row.session_id,
      threadMode: row.thread_mode,
      ranAt: new Date(),
      nextRunAt: null,
      jobName: row.name,
      error: result.status === "error" ? result.error : null,
    });
  }

  getModel() {
    return resolveMyAxModel(this.env, this.getConfig<MyAgentConfig>()?.model ?? defaultModelId(this.env)).model;
  }

  getTools() {
    return {
      ...createThinkTools(() => this.buildToolContext()),
      ...createMyAxBrowserTools(this.env, () => this.identity(), () => this.name),
      delegate_many: createDelegateManyTool(this),
    };
  }

  override async onBeforeSubAgent(_request: Request, child: { className: string; name: string }) {
    // The durable official registry survives parent eviction/deploy. Never gate
    // retained children with an in-memory allowlist.
    if (child.className !== ReadOnlyDelegateAgent.name || !this.hasAgentToolRun(child.className, child.name)) {
      return new Response("Delegate not registered by canonical parent", { status: 404 });
    }
  }

  private async ensureNativeMcp(): Promise<void> {
    const identity = this.identity();
    if (!identity) return;
    const workerOrigin = resolveBridgeOrigin(this.env.BRIDGE_BASE_URL);
    if (!workerOrigin) {
      console.error("native_mcp_hydration_skipped_invalid_bridge_base_url", { bridgeBaseUrl: this.env.BRIDGE_BASE_URL ? "set" : "empty" });
      return;
    }
    const store = makeOAuthClientStore(this.env.OAUTH_CLIENT, workerOrigin);
    const register = async (id: string, upstream: string) => {
      const existingEntry = Object.entries(this.getMcpServers().servers).find(([, server]) => server.name === id);
      const token = await store.getValidAccessToken(identity.email, id).catch(() => null);
      if (!token) {
        // Disconnect/remove is immediate revocation for this live facet, not
        // merely prevention of future hydration after isolate eviction.
        if (existingEntry) await this.mcp.removeServer(existingEntry[0]).catch(() => undefined);
        return;
      }
      if (existingEntry) {
        const discovered = this.mcp.listTools().some((catalogTool) => catalogTool.serverId === existingEntry[0]);
        if (discovered) return;
        // A persisted registration can reconnect with an empty catalog after a
        // deploy/upstream blip. Settings still says "authorized", but the model
        // sees no tools. Remove and re-add with the current token to force fresh
        // initialize/tools-list discovery.
        await this.mcp.removeServer(existingEntry[0]).catch(() => undefined);
      }
      // MCP hydration is best-effort: one server's initialize/tools-list
      // failure must not block chat or the LLM call. A stale connector surfaces
      // via the reauth banner instead.
      try {
        await this.addMcpServer(id, upstream, {
          transport: { type: "streamable-http", headers: { Authorization: `Bearer ${token}` } },
        });
      } catch (err) {
        console.error("mcp_hydrate_failed", { server: id, err: err instanceof Error ? err.message : String(err) });
      }
    };
    // Public deployments default to no built-ins. Private wrappers can inject
    // a portal without coupling this runtime to its tools or underlying harness.
    const configured = Object.values(getBuiltinConnectors(this.env));
    try { configured.push(...await store.listUserMcps(identity.email)); }
    catch (err) { console.error("mcp_list_user_mcps_failed", { err: err instanceof Error ? err.message : String(err) }); }
    const configuredIds = new Set(configured.map((mcp) => mcp.id));
    for (const [serverId, server] of Object.entries(this.getMcpServers().servers)) {
      if (!configuredIds.has(server.name)) await this.mcp.removeServer(serverId).catch(() => undefined);
    }
    for (const mcp of configured) await register(mcp.id, mcp.upstream);
  }

  private identity(): AccessIdentity | undefined {
    return this.getConfig<MyAgentConfig>()?.identity;
  }

  private async logAcceptedUsers(): Promise<void> {
    const identity = this.identity();
    if (!identity) return;
    const users = this.messages.filter((message) => message.role === "user");
    let insertedLatest = false;
    for (const message of users) {
      const existing = await this.env.DB.prepare("SELECT id FROM conversation_entries WHERE session_id = ? AND owner_email = ? AND role = 'user' AND ui_message_id = ? LIMIT 1")
        .bind(this.name, identity.email, message.id).first<{ id: number }>().catch(() => null);
      if (existing) continue;
      const attachments = attachmentParts(message);
      await logUserMessage(this.env, identity, this.name, textParts(message), {
        uiMessageId: message.id,
        ...(attachments.length ? { attachments } : {}),
      });
      if (message === users[users.length - 1]) insertedLatest = true;
    }
    const latest = users[users.length - 1];
    // Reconnect/open walks persisted Think history to backfill missing D1 rows,
    // but must not make an old conversation look newly active. Only a newly
    // accepted user turn advances the drawer's activity time/order.
    if (!latest || !insertedLatest) return;
    const first = users.length === 1;
    const statement = first
      ? this.env.DB.prepare("UPDATE sessions SET name = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ?").bind(deriveSessionTitle(textParts(latest)), this.name, identity.email)
      : this.env.DB.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ? AND owner_email = ?").bind(this.name, identity.email);
    await statement.run().catch((error) => console.error("think_session_touch_failed", { err: String(error) }));
  }

  /**
   * Symmetric to logAcceptedUsers, for the ASSISTANT side. logAssistantMessage
   * only runs in onChatResponse (normal completion); a turn that is interrupted,
   * replaced, or recovery-exhausted never lands its reply in the durable D1
   * transcript, so the restored history shows only the owner's messages (the
   * 186-user vs 2-assistant Master session). Think's in-memory this.messages IS
   * authoritative and retains those assistant turns, so we idempotently backfill
   * any missing assistant rows from it on the same triggers that sync users.
   * uiMessageId dedup in appendConversationLog makes this safe to call anytime.
   * Best-effort: never throws, never touches session activity time/order.
   */
  private async reconcileAssistantHistory(): Promise<void> {
    const identity = this.identity();
    if (!identity) return;
    const candidates = assistantBackfillCandidates(
      this.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: textParts(message),
        reasoning: reasoningParts(message),
      })),
    );
    for (const message of candidates) {
      const existing = await this.env.DB.prepare("SELECT id FROM conversation_entries WHERE session_id = ? AND owner_email = ? AND role = 'assistant' AND ui_message_id = ? LIMIT 1")
        .bind(this.name, identity.email, message.id).first<{ id: number }>().catch(() => null);
      if (existing) continue;
      await logAssistantMessage(this.env, identity, this.name, message.text, {
        uiMessageId: message.id,
        model: this.getConfig<MyAgentConfig>()?.model ?? defaultModelId(this.env),
        ...(message.reasoning ? { reasoning: message.reasoning } : {}),
        backfilled: true,
      }).catch((error) => console.error("think_assistant_backfill_failed", { sessionId: this.name, err: String(error) }));
    }
  }

  async onChatResponse(result: ChatResponseResult) {
    const identity = this.identity();
    if (!identity) return;
    await this.recordCurrentCycleCost(result).catch((error) => console.error("cycle_cost_record_failed", { sessionId: this.name, err: String(error) }));
    await this.logAcceptedUsers();
    await this.completeInjectedRecurringJobRun(result).catch((error) => console.error("recurring_job_terminal_receipt_failed", { sessionId: this.name, err: String(error) }));
    const content = textParts(result.message);
    const reasoning = reasoningParts(result.message);
    const visibleContent = visibleAssistantContent({ status: result.status, content, error: result.error, ownerNotified: this.notifiedOwnerThisTurn });
    if (visibleContent || reasoning || result.status === "error") {
      await logAssistantMessage(this.env, identity, this.name, visibleContent, {
        uiMessageId: result.message.id,
        model: this.getConfig<MyAgentConfig>()?.model ?? defaultModelId(this.env),
        ...(reasoning ? { reasoning } : {}),
        status: result.status,
        ...(content.trim() ? {} : { emptyVisibleResponse: true }),
      });
    }
    // Workspace durability: one snapshot per turn that touched /home/user.
    // Sandbox containers idle out and get recycled; without a snapshot,
    // anything the agent wrote (write_file, shell_exec mkdir, etc.) is
    // lost on next page load. afterToolCall sets dirtyFsThisTurn on every
    // non-read-only successful tool; we capture it here once per turn.
    //
    // PREREQUISITE: R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set
    // via `wrangler secret put`. Without them, sandbox.createBackup throws
    // 'Backup requires R2 presigned URL credentials.'
    const hasVisibleChat = [...this.getConnections<{ chatVisible?: boolean }>()]
      .some((connection) => connection.state?.chatVisible === true);
    if (shouldSendCompletionNotification({
      status: result.status,
      hasVisibleChat,
      ownerNotified: this.notifiedOwnerThisTurn,
      automaticRecovery: identity.sub === "system:auto-revive",
    })) {
      // Carry the actual reply (and the prompt for context) into the push so a
      // completion notification is useful on its own, not just "turn complete".
      const lastUser = [...this.messages].reverse().find((m) => m.role === "user");
      const prompt = lastUser ? textParts(lastUser) : "";
      const title = prompt ? deriveSessionTitle(prompt) : "";
      const reply = visibleCompletionNotificationBody(visibleContent.replace(/\s+/g, " ").trim());
      await notifyOwner(this.env, identity.email, {
        kind: "session.update",
        sessionId: this.name,
        title: title ? `My AX: ${title.slice(0, 60)}` : "My AX finished",
        body: reply,
        href: `/?session=${encodeURIComponent(this.name)}`,
      }).catch((error) => console.error("turn_completion_push_failed", { sessionId: this.name, err: String(error) }));
    }
    await this.env.DB.prepare("UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ?")
      .bind(result.status === "error" ? "error" : "active", this.name, identity.email)
      .run()
      .catch((error) => console.error("think_session_status_settled_failed", { err: String(error) }));

    // A successful mutating tool commits workspace state even if a later model
    // step errors. The live Sandbox cannot roll back, so skipping the snapshot
    // would make successful writes disappear on recycle.
    this.notifiedOwnerThisTurn = false;
    if (this.dirtyFsThisTurn) {
      this.dirtyFsThisTurn = false;
      try {
        await snapshotUserWorkspace(this.env, identity, "turn");
      } catch (err) {
        // Non-fatal: the turn itself already succeeded. Surface the
        // failure mode in console.error so wrangler tail / Logpush can pick
        // it up; if console.log isn't surfacing from the DO, the worker
        // still ran — the next deployer will see the issue when running
        // `wrangler tail` directly.
        console.error("workspace_snapshot_at_turn_end_failed", {
          email: identity.email,
          sessionId: this.name,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      this.dirtyFsThisTurn = false;
    }
  }

  onConnect(connection: Parameters<Think<Env>["onConnect"]>[0], ctx: Parameters<Think<Env>["onConnect"]>[1]) {
    // Identity is seeded from the JWT verified by accessMiddleware. Never trust
    // the request's convenience email header as an authorization principal.
    super.onConnect(connection, ctx);
    this.logAcceptedUsers().catch((error) => console.error("think_user_log_sync_failed", { err: String(error) }));
    // P1 transcript-race Stage 3: keep assistant-history reconciliation OFF the
    // open hot path. It backfills assistant rows Think has but D1 missed
    // (interrupted turns); it is idempotent and needed neither before first paint
    // nor before the cf_agent_chat_messages replay. Defer it past onConnect via a
    // macrotask so a long-thread open is never blocked by a per-assistant D1
    // dedup pass on connect. The DO stays alive while the connection is open.
    setTimeout(() => {
      this.reconcileAssistantHistory().catch((error) => console.error("think_assistant_log_sync_failed", { err: String(error) }));
    }, 0);
  }

  async onMessage(connection: Parameters<Think<Env>["onMessage"]>[0], message: unknown) {
    try {
      const parsed = typeof message === "string" ? JSON.parse(message) as { type?: string; visible?: boolean } : null;
      // Liveness ping keeps the client's watchdog from treating a healthy, idle
      // socket as stale and force-reconnecting it.
      if (parsed?.type === "my_ax_ping") {
        try { connection.send(JSON.stringify({ type: "my_ax_pong", at: Date.now() })); } catch {}
        return;
      }
      if (parsed?.type === "my_ax_visibility") {
        connection.setState({ ...((connection.state ?? {}) as Record<string, unknown>), chatVisible: parsed.visible === true });
        return;
      }
      // page.* codemode connector: the live client's reply to a page_call.
      if (parsed?.type === "page_result") {
        const p = parsed as { requestId?: string; ok?: boolean; result?: unknown; error?: string };
        const pending = p.requestId ? this.pendingPageCalls.get(p.requestId) : undefined;
        if (pending && p.requestId) {
          this.pendingPageCalls.delete(p.requestId);
          clearTimeout(pending.timer);
          if (p.ok) pending.resolve(p.result ?? null);
          else pending.reject(new Error(p.error || "page verb failed"));
        }
        return;
      }
    } catch {}
    return super.onMessage(connection, message as Parameters<Think<Env>["onMessage"]>[1]);
  }


  /**
   * Run one chat turn for an EXTERNAL caller (the voice agent) and collect the
   * full assistant text. This runs on the canonical MyAgent facet, so the
   * reply is appended to this session's Think transcript and broadcast as
   * cf_agent_* frames to any open chat socket. Returns the text for TTS.
   *
   * Why this exists: the @cloudflare/voice call lifecycle (start_call ->
   * audio_config/listening) does NOT survive the agents sub-agent WebSocket
   * bridge — proven by /voice-proof working via routeAgentRequest while a
   * facet socket silently drops start_call. So voice runs on its own
   * direct-routed DO (VoiceThinkAgent) and delegates the actual turn here by
   * RPC. See the direct-routed voice agent in src/voice-think-agent.ts.
   */
  async runVoiceTurn(transcript: string): Promise<string> {
    const cfg = this.getConfig<MyAgentConfig>() ?? {};
    if (cfg.model && !findModel(cfg.model)) {
      this.configure<MyAgentConfig>({ ...cfg, model: defaultModelId(this.env) });
    }
    let full = "";
    let failure: string | null = null;
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      void (Think.prototype.chat.call(this, transcript, {
        onStart: async () => {},
        onEvent: async (json: string) => {
          try {
            const chunk = JSON.parse(json) as { type?: string; delta?: string };
            if (chunk.type === "text-delta" && chunk.delta) full += chunk.delta;
          } catch {}
        },
        onDone: async () => { done(); },
        onError: async (error: string) => { failure = error; done(); },
      }, {}) as Promise<void>).catch((e: unknown) => {
        failure = failure ?? (e instanceof Error ? e.message : String(e));
        done();
      });
    });
    if (failure && !full) throw new Error(failure);
    return full;
  }

  async afterToolCall(ctx: ToolCallResultContext) {
    const identity = this.identity();
    if (!identity) return;
    // Mark the turn dirty if this tool MAY have written under /home/user.
    // Repository tools may snapshot inline; marking the turn dirty is still safe
    // because an additional workspace snapshot is a no-op delta.
    if (ctx.success && !READ_ONLY_TOOLS.has(ctx.toolName)) {
      this.dirtyFsThisTurn = true;
    }
    if (ctx.success && ctx.toolName === "notify_owner") {
      this.notifiedOwnerThisTurn = true;
    }
    await logToolCall(this.env, identity, this.name, ctx.toolName, ctx.input, {
      content: ctx.success ? (typeof ctx.output === "string" ? ctx.output : JSON.stringify(ctx.output)) : (ctx.error instanceof Error ? ctx.error.message : String(ctx.error)),
      isError: !ctx.success,
    }, { toolCallId: ctx.toolCallId, durationMs: ctx.durationMs });
  }

  private async terminalizeExhaustedRecovery(ctx: ChatRecoveryExhaustedContext): Promise<void> {
    const identity = this.identity();
    console.error("chat_recovery_exhausted", {
      sessionId: this.name,
      incidentId: ctx.incidentId,
      reason: ctx.reason,
      attempt: ctx.attempt,
      recoveryKind: ctx.recoveryKind,
    });
    if (!identity) return;
    await recordRecoveryExhaustion(this.env, identity, this.name, {
      terminalMessage: ctx.terminalMessage,
      incidentId: ctx.incidentId,
      reason: ctx.reason,
    }).catch((error) => console.error("chat_recovery_terminalization_failed", {
      sessionId: this.name,
      err: String(error),
    }));
  }

  onChatError(error: unknown) {
    const identity = this.identity();
    if (identity) {
      appendConversationLog(this.env, identity, this.name, {
        ts: new Date().toISOString(),
        role: "error",
        content: error instanceof Error ? error.message : String(error),
        meta: errorConversationMeta(error),
      }).catch(() => {});
    }
    return error;
  }

  private buildToolContext(): ToolContext {
    const config = this.getConfig<MyAgentConfig>();
    const identity = config?.identity;
    if (!identity) throw new Error("Think session identity not seeded before tool call.");
    const env = this.env;
    const sessionId = this.name;
    const workingDirectory = WORKSPACE_HOME;
    return {
      workingDirectory,
      notifyOwner: (input) => notifyOwner(env, identity.email, { ...input, sessionId }),
      shellExec: async (cmd, opts) => {
        const { sandbox } = await getUserWorkspace(env, identity);
        const result = await sandbox.exec(cmd, { cwd: opts?.cwd ?? workingDirectory, timeout: opts?.timeout ?? 30_000, env: { ACCESS_EMAIL: identity.email, XDG_CONFIG_HOME: "/home/user/.config", ...opts?.env } });
        return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.exitCode ?? (result.success ? 0 : 1) };
      },
      processStart: async (cmd, opts) => {
        const { sandbox } = await getUserWorkspace(env, identity);
        const process = await sandbox.startProcess(cmd, { cwd: opts?.cwd ?? workingDirectory, timeout: opts?.timeout, processId: opts?.processId, autoCleanup: false, env: { ACCESS_EMAIL: identity.email, XDG_CONFIG_HOME: "/home/user/.config", ...opts?.env } });
        return { id: process.id, pid: process.pid, command: process.command, status: process.status, startTime: process.startTime.toISOString(), endTime: process.endTime?.toISOString(), exitCode: process.exitCode, sessionId: process.sessionId };
      },
      processStatus: async (id) => {
        const { sandbox } = await getUserWorkspace(env, identity);
        const process = await sandbox.getProcess(id);
        if (!process) return null;
        await process.getStatus();
        const current = (await sandbox.getProcess(id)) ?? process;
        return { id: current.id, pid: current.pid, command: current.command, status: current.status, startTime: current.startTime.toISOString(), endTime: current.endTime?.toISOString(), exitCode: current.exitCode, sessionId: current.sessionId };
      },
      processLogs: async (id) => {
        const { sandbox } = await getUserWorkspace(env, identity);
        const process = await sandbox.getProcess(id);
        if (!process) return null;
        const logs = await sandbox.getProcessLogs(id);
        return { processId: logs.processId, stdout: logs.stdout ?? "", stderr: logs.stderr ?? "" };
      },
      processCancel: async (id, signal) => {
        const { sandbox } = await getUserWorkspace(env, identity);
        if (!(await sandbox.getProcess(id))) return false;
        await sandbox.killProcess(id, signal ?? "SIGTERM");
        return true;
      },
      runCode: async (code, options) => {
        const { sandbox } = await getUserWorkspace(env, identity);
        return sandbox.runCode(code, { language: options?.language, timeout: options?.timeout, envVars: { ACCESS_EMAIL: identity.email, XDG_CONFIG_HOME: "/home/user/.config" } });
      },
      tunnelGet: async (port) => {
        const { sandbox } = await getUserWorkspace(env, identity);
        return sandbox.tunnels.get(port);
      },
      tunnelList: async () => {
        const { sandbox } = await getUserWorkspace(env, identity);
        return sandbox.tunnels.list();
      },
      tunnelDestroy: async (port) => {
        const { sandbox } = await getUserWorkspace(env, identity);
        await sandbox.tunnels.destroy(port);
      },
      readFile: async (path) => (await new SandboxThinkWorkspace(env, () => identity).readFile(path)) ?? "",
      writeFile: async (path, content) => new SandboxThinkWorkspace(env, () => identity).writeFile(path, content),
      listFiles: async (path, opts) => {
        const { sandbox } = await getUserWorkspace(env, identity);
        const result = await sandbox.listFiles(path, opts);
        return result.files.map((file) => ({ path: file.absolutePath, name: file.name, type: file.type, size: file.size }));
      },
      searchConversations: async (query, limit = 20) => {
        // Extract word tokens and AND them as quoted terms so punctuation and
        // FTS5 operators in code or debugging searches cannot invalidate syntax.
        const tokens = (query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 24);
        if (!tokens.length) return [];
        const ftsQuery = tokens.map((token) => `"${token}"`).join(" ");
        const result = await env.DB.prepare(`SELECT e.session_id AS sessionId, e.ts, e.role, snippet(conversation_entries_fts, 0, '<<', '>>', '…', 24) AS snippet FROM conversation_entries_fts JOIN conversation_entries e ON e.id = conversation_entries_fts.rowid WHERE conversation_entries_fts MATCH ? AND e.owner_email = ? ORDER BY bm25(conversation_entries_fts) LIMIT ?`).bind(ftsQuery, identity.email.toLowerCase(), Math.max(1, Math.min(limit, 100))).all<{ sessionId: string; ts: string; role: string; snippet: string }>();
        return result.results ?? [];
      },
      createSvelteArtifact: (input) => createSvelteArtifact(env, identity, sessionId, input),
      sendVoiceMessage: async (input) => {
        const clip = await createAudioMessage(env, identity, sessionId, input);
        // Deliver a push deep-linking back to this conversation so the owner can
        // open the inline player, mirroring artifact/ask_user delivery.
        await notifyOwner(env, identity.email, {
          kind: "session.update",
          sessionId,
          title: "my · ax voice message",
          body: clip.title,
          href: `/?session=${encodeURIComponent(sessionId)}`,
        }).catch((error) => console.error("voice_message_push_failed", { sessionId, err: error instanceof Error ? error.message : String(error) }));
        return clip;
      },
      listSavedRecipes: async () => {
        // Dual-read from cm_snippets projection first, falling back to an
        // in-memory projection of enabled saved_recipes when the
        // projection table is empty (transition seam). Returns codemode-
        // native shape so the snippet hook surface is consistent with the
        // native runtime.
        const snippets = await listSnippetsDualRead(env, identity.email);
        // Mirror the authoritative capability list from saved_recipes
        // where present, since cm_snippets records only connector names.
        // The capability bound enforced at run time still comes from the
        // saved_recipes row (intersected with caller grants), so this
        // list is advisory metadata for the model only.
        const recipes = await new SavedRecipeService(env, identity.email).list();
        const recipeByName = new Map(recipes.filter((r) => r.status === "enabled").map((r) => [r.name, r] as const));
        return snippets.map((snippet) => {
          const recipe = recipeByName.get(snippet.name);
          return {
            id: snippet.sourceRecipeId ?? snippet.id,
            name: snippet.name,
            description: snippet.description,
            inputSchema: snippet.inputSchema,
            capabilities: recipe?.capabilities ?? snippet.capabilities,
            codemodeExecutionId: snippet.codemodeExecutionId,
            sourceRecipeId: snippet.sourceRecipeId,
            provenance: snippet.provenance,
          };
        });
      },
      runSavedRecipe: async (input) => {
        let recipeId = input.id?.trim();
        if (!recipeId && input.name?.trim()) {
          const name = input.name.trim();
          const matches = (await new SavedRecipeService(env, identity.email).list()).filter((recipe) => recipe.status === "enabled" && recipe.name === name);
          if (matches.length !== 1) throw new Error(matches.length ? `ambiguous recipe name: ${name}` : `saved recipe not found: ${name}`);
          recipeId = matches[0].id;
        }
        if (!recipeId) throw new Error("recipe.run requires id or exact name");
        // Forward the caller's capability bounds so runSavedRecipe can
        // intersect (never widen) the snippet's declared capabilities
        // against what the parent turn was allowed to do.
        const result = await this.runSavedRecipe({
          recipeId,
          input: input.input ?? {},
          callerCapabilities: input.callerCapabilities,
        });
        const resultWithRecipe = result as { recipe?: { name?: string }; codemodeExecutionId?: string };
        this.recipesUsedThisTurn.push({
          recipeId,
          name: resultWithRecipe?.recipe?.name ?? input.name ?? null,
          codemodeExecutionId: resultWithRecipe?.codemodeExecutionId ?? null,
        });
        return result;
      },
      broadcast: (message) => this.broadcast(message),
      callPage: (verb, args, opts) => this.callPage(verb, args, opts),
      identity,
      sessionId,
      bridgeBaseUrl: env.BRIDGE_BASE_URL,
      bridgeJwtSecret: env.BRIDGE_JWT_SECRET,
      env,
      // Lenient: never throw here for pure work_code. Connector-OAuth flows
      // validate the origin at their point of use.
      workerOrigin: resolveWorkerOrigin(env),
    };
  }

  /**
   * page.* codemode connector bridge. Marshal one curated verb to the live chat
   * client over the existing WebSocket and await its page_result. Prefers a
   * chat-visible connection; falls back to any live connection. Rejects with a
   * typed error if no client is connected or the client does not reply in time.
   */
  /**
   * Dev-only page.* bridge probe (RPC). Exercises the full DO->client->DO
   * round-trip (callPage -> page_call -> client registry -> page_result)
   * WITHOUT an LLM inference. Guarded by DEV_USER_EMAIL (unset in prod).
   */
  async devPageCall(verb: string, args?: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    if (!this.env.DEV_USER_EMAIL) return { ok: false, error: "dev only" };
    try {
      const result = await this.callPage(verb, args ?? {});
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Dev-only: run real work_code THROUGH the sandbox executor (not the raw
   * callPage bridge), so we can prove the bare `page.*` global is wired into the
   * work_code scope without an LLM. Guarded by DEV_USER_EMAIL (unset in prod).
   */
  async devWorkCode(code: string): Promise<unknown> {
    if (!this.env.DEV_USER_EMAIL) return { ok: false, error: "dev only" };
    return executeWorkCode(code, this.buildToolContext());
  }

  private callPage(verb: string, args?: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown> {
    const connections = [...this.getConnections<{ chatVisible?: boolean }>()];
    if (connections.length === 0) return Promise.reject(new Error("page_unavailable: no live browser client connected to this session"));
    const requestId = `page-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const timeoutMs = Math.min(Math.max(opts?.timeoutMs ?? 10_000, 1000), 30_000);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPageCalls.delete(requestId);
        reject(new Error(`page_timeout: verb ${verb} did not reply within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendingPageCalls.set(requestId, { resolve, reject, timer });
      try {
        // broadcast (not connection.send): the socket-owning isolate delivers
        // reliably under hibernation; the client filters by requestId and only
        // the tab holding this conversation replies with page_result.
        this.broadcast(JSON.stringify({ type: "page_call", requestId, verb, args: args ?? {} }));
      } catch (e) {
        this.pendingPageCalls.delete(requestId);
        clearTimeout(timer);
        reject(new Error(`page_send_failed: ${String(e)}`));
      }
    });
  }

  async beforeTurn(ctx: { body?: Record<string, unknown>; messages: ModelMessage[] }) {
    // Agent.mcp is the native protocol/OAuth/tool-discovery implementation.
    // Register shared-user bearer connections lazily, then merge the freshly
    // discovered native tools into this first turn too (Think assembled its
    // base tool set immediately before calling beforeTurn).
    await this.ensureNativeMcp();
    // Persist the inbound user message before the model call so stalled turns
    // remain available when the client resyncs. logAcceptedUsers is idempotent.
    await this.logAcceptedUsers().catch((error) => console.error("think_user_log_before_turn_failed", { err: String(error) }));
    // Symmetric backfill: recover any assistant turn from a prior interrupted/
    // replaced turn that never reached onChatResponse. Idempotent.
    await this.reconcileAssistantHistory().catch((error) => console.error("think_assistant_log_before_turn_failed", { err: String(error) }));
    const identity = this.identity();
    if (identity) {
      await this.env.DB.prepare("UPDATE sessions SET status = 'running', updated_at = datetime('now') WHERE id = ? AND owner_email = ?")
        .bind(this.name, identity.email)
        .run()
        .catch((error) => console.error("think_session_status_running_failed", { err: String(error) }));
    }
    const body = ctx.body ?? {};
    const requestedModel = typeof body.model === "string" && findModel(body.model) ? body.model : undefined;
    const effort = body.reasoningEffort === "low" || body.reasoningEffort === "medium" || body.reasoningEffort === "high"
      ? body.reasoningEffort
      : undefined;
    if (requestedModel || effort) {
      const current = this.getConfig<MyAgentConfig>() ?? {};
      this.configure<MyAgentConfig>({ ...current, ...(requestedModel ? { model: requestedModel } : {}), ...(effort ? { reasoningEffort: effort } : {}) });
    }
    const config = this.getConfig<MyAgentConfig>() ?? {};
    const selected = requestedModel ?? config.model ?? defaultModelId(this.env);
    const resolved = resolveMyAxModel(this.env, selected);
    const attachmentByPath = new Map<string, Attachment>();
    for (const message of this.messages.filter((item) => item.role === "user")) {
      for (const attachment of attachmentParts(message)) {
        attachmentByPath.set(`/api/uploads/${encodeURIComponent(attachment.key)}`, attachment);
      }
    }
    let preparationError: string | null = null;
    const messages = await Promise.all(ctx.messages.map(async (message) => {
      if (message.role !== "user" || !Array.isArray(message.content)) return message;
      const content = message.content as Array<{ type: string; text?: string; data?: string | Uint8Array; mediaType?: string }>;
      const references = content.flatMap((part) => {
        if (part.type !== "file" || typeof part.data !== "string") return [];
        const attachment = attachmentByPath.get(part.data);
        return attachment ? [attachment] : [];
      });
      if (!references.length) return message;
      const ordinary = content.filter((part) => !(part.type === "file" && typeof part.data === "string" && attachmentByPath.has(part.data))) as Array<{ type: "text"; text: string } | { type: "file"; data: Uint8Array; mediaType: string }>;
      if (resolved.meta.vision && identity) {
        for (const attachment of references) {
          try {
            ordinary.push({ type: "file", data: await readUploadBytes(this.env, identity, attachment), mediaType: attachment.mime });
          } catch (error) {
            preparationError = error instanceof Error ? error.message : String(error);
            ordinary.push({ type: "text", text: `\n\n[Image attachment unavailable: ${preparationError}. Continue without the image and explain that it could not be loaded.]` });
          }
        }
      } else {
        ordinary.push({ type: "text", text: `\n\n[${references.length} image attachment(s) omitted: selected model does not accept vision input.]` });
      }
      return { ...message, content: ordinary } as ModelMessage;
    }));
    const nativeMcpTools = this.mcp.getAITools();
    const mcpCodeMode = createOfficialMcpCodeModeTool({
      env: this.env,
      mcp: this.mcp,
      servers: this.getMcpServers().servers,
    });
    // Heal tool-call ids that an earlier provider may have stored in a shape a
    // strict provider (Anthropic) rejects, so resuming or forking a session never
    // fails with a tool_use.id pattern error. Idempotent for already-valid ids.
    const safeMessages = sanitizeToolCallIds(messages, (idBefore, idAfter) =>
      console.warn("tool_call_id_sanitized", { sessionId: this.name, before: idBefore, after: idAfter }),
    );
    const dogfoodNoToolTurn = safeMessages.some((message) => message.role === "user" && typeof message.content === "string" && message.content.includes("MY_AX_RECIPE_CURVE_NO_TOOLS"));
    return {
      model: resolved.model,
      messages: safeMessages,
      ...(dogfoodNoToolTurn ? { activeTools: [] } : {}),
      // Native MCP and Code Mode tools bypass createThinkTools, so bound their
      // model-visible output here too — otherwise a connector MCP result is an
      // unbounded context firehose that can stall a turn.
      tools: limitToolSetOutput({
        ...nativeMcpTools,
        ...(mcpCodeMode ? { mcp_code_mode: mcpCodeMode } : {}),
      }),
      // Terminalize a parked provider stream so the UI cannot remain in a dead
      // "working" state. With chatRecovery on, bounded recovery runs first.
      // Set well above the slowest tool/model time-to-first-token.
      chatStreamStallTimeoutMs: 120_000,
      // Every model presented in my-ax is an agent model: all receive the
      // same durable tool surface. Keep route-specific failures visible and
      // fix the integration rather than silently degrading models to chat.
      // Stop when the model is done using tools, but also impose an
      // independent hard cap. `maxSteps` above is Think's outer guard;
      // stepCountIs keeps the AI SDK loop bounded too.
      stopWhen: [
        stepCountIs(this.maxSteps),
        (({ steps }) => {
          const last = steps[steps.length - 1];
          return Boolean(last && last.toolCalls.length === 0);
        }) as StopCondition<ToolSet>,
      ],
      ...(resolved.meta.route === "gateway-openai"
        ? { providerOptions: { openai: { store: false } } }
        : resolved.meta.route === "gateway-anthropic"
          ? {
              providerOptions: {
                anthropic: {
                  // The system prompt + tool definitions are stable and
                  // large; cache them between turns to cut input
                  // cost/latency.
                  cacheControl: { type: "ephemeral", ttl: "1h" },
                  ...(resolved.meta.reasoning && (effort ?? config.reasoningEffort)
                    ? { thinking: { type: "adaptive" } }
                    : {}),
                },
              },
            }
          : resolved.meta.reasoning && (effort ?? config.reasoningEffort)
            ? { providerOptions: { workersai: { reasoning_effort: effort ?? config.reasoningEffort } } }
            : {}),
    };
  }

  onStepFinish(ctx: { stepNumber: number; text: string; toolCalls: unknown[]; toolResults: unknown[]; finishReason: string; usage?: { inputTokens?: number | null; outputTokens?: number | null; totalTokens?: number | null } }) {
    this.cycleStepUsage.push({ usage: ctx.usage, finishReason: ctx.finishReason });
    console.log("agent_step", {
      step: ctx.stepNumber,
      textBytes: ctx.text?.length ?? 0,
      toolCalls: ctx.toolCalls?.length ?? 0,
      toolResults: ctx.toolResults?.length ?? 0,
      finishReason: ctx.finishReason,
      usage: ctx.usage ? { inputTokens: ctx.usage.inputTokens, outputTokens: ctx.usage.outputTokens, totalTokens: ctx.usage.totalTokens } : null,
    });
  }

  private async recordCurrentCycleCost(result: ChatResponseResult): Promise<void> {
    const identity = this.identity();
    if (!identity) return;
    const steps = this.cycleStepUsage.splice(0);
    const recipesUsed = this.recipesUsedThisTurn.splice(0);
    const recipesSaved = this.recipesSavedThisTurn.splice(0);
    await this.promoteSuggestedRecipe(result).catch((error) => {
      recipesSaved.push({ ok: false, error: error instanceof Error ? error.message : String(error) });
      console.error("recipe_promotion_failed", { sessionId: this.name, err: error instanceof Error ? error.message : String(error) });
    });
    const usage: CycleCostUsage = steps.length
      ? {
          inputTokens: steps.some((step) => typeof step.usage?.inputTokens === "number") ? steps.reduce((sum, step) => sum + (step.usage?.inputTokens ?? 0), 0) : null,
          outputTokens: steps.some((step) => typeof step.usage?.outputTokens === "number") ? steps.reduce((sum, step) => sum + (step.usage?.outputTokens ?? 0), 0) : null,
          totalTokens: steps.some((step) => typeof step.usage?.totalTokens === "number") ? steps.reduce((sum, step) => sum + (step.usage?.totalTokens ?? 0), 0) : null,
          basis: "ai_sdk_step_usage",
        }
      : { inputTokens: null, outputTokens: null, totalTokens: null, basis: "unavailable" };
    await recordCycleCost(this.env, {
      ownerEmail: identity.email,
      sessionOrRunId: this.name,
      cycleIndex: await nextCycleIndex(this.env, identity.email, this.name),
      model: this.getConfig<MyAgentConfig>()?.model ?? defaultModelId(this.env),
      finishReason: steps.at(-1)?.finishReason ?? result.status,
      usage,
      recipesUsed,
      recipesSaved,
    });
  }

  private async promoteSuggestedRecipe(result: ChatResponseResult): Promise<void> {
    const identity = this.identity();
    if (!identity || result.status !== "completed") return;
    // Only work_code outputs are candidates for promotion. Every other tool's
    // JSON output is opaque to this policy — a match on suggestedRecipe there
    // would let an unrelated tool payload smuggle a recipe onto the shelf.
    // The tool-name filter narrows the search to work_code parts only.
    const workCodeOutputs = result.message.parts.flatMap((part) => {
      const candidate = part as { type?: string; toolName?: string; output?: unknown; state?: string };
      if (candidate.state !== "output-available") return [];
      // Think surfaces AI SDK parts as either type "tool-work_code" (name in
      // the type suffix) or type "tool-call" with a toolName field. Accept
      // both so upstream tool-part shape drift doesn't silently drop
      // promotions.
      const isWorkCode = candidate.type === "tool-work_code"
        || (candidate.type?.startsWith("tool-") && candidate.toolName === "work_code");
      return isWorkCode ? [candidate.output] : [];
    });
    // The owner chooses whether qualifying reusable tools wait for review or
    // become enabled immediately. The stored owner preference wins; the legacy
    // deploy variable remains a migration-safe fallback when no choice exists.
    const trustMode = await reusableToolApprovalMode(this.env, identity.email);
    const autoEnable = trustMode === "auto";
    for (const output of workCodeOutputs) {
      const text = typeof output === "string" ? output : JSON.stringify(output);
      let parsed:
        | {
            ok?: boolean;
            suggestedRecipe?: unknown;
            reusableToolCandidate?: unknown;
            portable?: unknown;
            inferredCapabilities?: unknown;
          }
        | null = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (!parsed?.ok || !parsed.suggestedRecipe) continue;
      // Marker-driven eligibility gate (frozen contract). A work_code result
      // without an eligible reusableToolCandidate is inline-only, no matter
      // what suggestedRecipe looks like.
      const candidate = parsed.reusableToolCandidate as ReusableToolCandidate | undefined;
      if (!candidate || !candidate.eligible) continue;
      const raw = parsed.suggestedRecipe as Record<string, unknown>;
      const capabilities = Array.isArray(raw.capabilities) ? raw.capabilities.map(String) : [];
      // High-authority machine./cloudbox. code with portable=false stays
      // inline. This is the same rule recipeApprovalDecision has always
      // enforced; the marker gate is additive, not a replacement.
      const decision = recipeApprovalDecision({
        autoTrust: autoEnable,
        capabilities,
        portable: typeof raw.portable === "boolean" ? raw.portable : undefined,
      });
      if (!shouldPersistSuggestedRecipe(decision)) continue;
      // Review mode is the safe default. Auto-enable is an explicit owner
      // preference and still cannot bypass the high-authority inline-only rule
      // enforced by recipeApprovalDecision above.
      const status = autoEnable ? "enabled" as const : "pending" as const;
      // Conflict fail-soft per iteration. A duplicate name from a previous
      // turn must not abort promotion of every later candidate in this same
      // result — catch InvalidInput / Conflict inside the loop, log, and
      // continue with the next candidate.
      let recipe;
      try {
        recipe = await new SavedRecipeService(this.env, identity.email).create({
          name: typeof raw.name === "string" && raw.name.trim() ? raw.name : `WorkCodeRecipe_${Date.now()}`,
          description: typeof raw.description === "string" ? raw.description : "Promoted from a successful work_code run.",
          inputSchema: raw.inputSchema && typeof raw.inputSchema === "object" ? raw.inputSchema : { type: "object", properties: {} },
          code: typeof raw.code === "string" ? raw.code : "return null;",
          capabilities,
          sourceRunId: this.name,
          status,
        });
      } catch (error) {
        if (error instanceof SavedRecipeError) {
          console.error("recipe_promotion_skipped", {
            sessionId: this.name,
            fingerprint: candidate.fingerprint,
            code: error.code,
            err: error.message,
          });
          this.recipesSavedThisTurn.push({
            ok: false,
            fingerprint: candidate.fingerprint,
            reason: error.code,
            error: error.message,
          });
          continue;
        }
        throw error;
      }
      // Enabled tools must enter the Code Mode projection immediately. Review
      // mode projects later through the explicit approval route.
      if (recipe.status === "enabled") {
        await projectSavedRecipe(this.env, await new SavedRecipeService(this.env, identity.email).get(recipe.id))
          .catch((error) => console.error("cm_snippet_projection_failed", { recipeId: recipe.id, err: error instanceof Error ? error.message : String(error) }));
      }
      this.recipesSavedThisTurn.push({
        id: recipe.id,
        name: recipe.name,
        status: recipe.status,
        trustMode,
        fingerprint: candidate.fingerprint,
      });
      if (decision.notify) {
        // Owner notification uses the rendered Settings deep-link (not the
        // legacy /api/recipes/<id>/approval JSON endpoint) so a tap lands on
        // Reusable tools where the owner can review, edit, and enable the
        // pending candidate — the single approval surface for the marker path.
        await notifyOwner(this.env, identity.email, {
          kind: "recipe.approval",
          sessionId: this.name,
          title: `Review reusable tool: ${recipe.name}`,
          body: `${recipe.description} Review its source and capabilities, then approve it if you want My AX to reuse it.`,
          href: `/?action=settings&section=recipes&recipe=${encodeURIComponent(recipe.name)}`,
        }).catch((error) => console.error("recipe_approval_attention_failed", { sessionId: this.name, err: String(error) }));
      }
    }
  }

  getSystemPrompt() {
    return PUBLIC_SYSTEM;
  }

  // Invisible conversation memory. The model writes to the "memory" context
  // block via Session's auto-wired set_context tool; it is persisted in this
  // conversation facet's SQLite namespace. Owner-wide recall lives in the D1
  // transcript/search projection; this block is not falsely advertised as
  // shared across facets. There is no separate memory UI.
  configureSession(session: Session) {
    return session
      .withContext("memory", {
        description:
          "Long-lived facts, decisions, and preferences for this conversation. Persist what later turns in this session should know. Do not store secrets, credentials, or sensitive data.",
        maxTokens: 2000,
      })
      .withCachedPrompt()
      // Hermes-style compaction: preserve head + recent tail, summarize the
      // middle, keep tool-call/result pairs coherent. Workspace outputs can
      // get large quickly; compact before they crowd out useful context.
      .onCompaction(
        createCompactFunction({
          summarize: async (prompt) =>
            (await generateText({
              model: this.getModel(),
              prompt,
            })).text,
        }),
      )
      .compactAfter(100_000);
  }
}

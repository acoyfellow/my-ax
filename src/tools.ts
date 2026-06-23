import { jsonSchema, tool, type Tool, type ToolSet } from "ai";
import type { ToolDef, ToolContext } from "./types";
import { createDecision } from "./routes/decisions";
import { WORK_CODE_TOOL, WORK_SEARCH_TOOL } from "./work-tools";
import { JobService } from "./job-service";
import { limitModelToolOutput } from "./tool-output-limit";

export const ASK_USER_TOOL: ToolDef = {
  name: "ask_user",
  description: "Ask the owner a single multiple-choice question and pause for their answer. Creates an interactive decision widget, sends a push notification deep-linking to it, and records the decision. Use this when you genuinely need a human choice (approval, selection, direction) before continuing — especially if the user may be away. After calling this, stop and wait; the user's choice arrives as a new message in this conversation.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "The single question to ask." },
      options: { type: "array", items: { type: "string" }, description: "2-4 short answer choices." },
    },
    required: ["question", "options"],
  },
  execute: async (args, ctx) => {
    const question = typeof args.question === "string" ? args.question.trim() : "";
    const options = Array.isArray(args.options) ? args.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 4) : [];
    if (!question) return JSON.stringify({ ok: false, error: "question is required" });
    if (options.length < 2) return JSON.stringify({ ok: false, error: "at least two options are required" });
    const decision = await createDecision(ctx.env, ctx.identity.email.toLowerCase(), ctx.sessionId, question, options);
    await ctx.notifyOwner({ kind: "job.needs_input", title: "My AX needs your input", body: question.slice(0, 160), href: decision.href }).catch(() => undefined);
    return JSON.stringify({ ok: true, awaiting: true, decisionId: decision.id, href: decision.href, options, note: "Stop and wait. The owner's choice will arrive as a new user message." });
  },
};

export const TOOLS: ToolDef[] = [
  ASK_USER_TOOL,
  WORK_SEARCH_TOOL,
  WORK_CODE_TOOL,
  {
    name: "manage_jobs",
    description: "List, create, update, pause, resume, run, delete, or inspect history for this owner's recurring prompt jobs.",
    parameters: { type: "object", properties: { action: { type: "string", enum: ["list", "create", "update", "pause", "resume", "run", "delete", "history"] }, id: { type: "string" }, sessionId: { type: "string" }, name: { type: "string" }, prompt: { type: "string" }, cadenceSecs: { type: "number" }, idempotencyKey: { type: "string" } }, required: ["action"] },
    execute: async (args, ctx) => {
      const jobs = new JobService(ctx.env, ctx.identity.email);
      const id = typeof args.id === "string" ? args.id : "";
      const action = args.action;
      const input = { sessionId: args.sessionId as string | undefined, name: args.name as string | undefined, prompt: args.prompt as string | undefined, cadenceSecs: args.cadenceSecs as number | undefined };
      const result = action === "list" ? await jobs.list()
        : action === "create" ? await jobs.create(input, args.idempotencyKey as string | undefined)
        : action === "update" ? await jobs.update(id, input)
        : action === "pause" ? await jobs.setPaused(id, true)
        : action === "resume" ? await jobs.setPaused(id, false)
        : action === "run" ? await jobs.run(id, args.idempotencyKey as string | undefined)
        : action === "delete" ? await jobs.delete(id)
        : action === "history" ? await jobs.history(id)
        : (() => { throw new Error("unknown job action"); })();
      return JSON.stringify({ ok: true, result });
    },
  },
  {
    name: "search_conversations",
    description: "Search the user's prior my-ax conversation history using the D1 full-text memory index. Use this when they ask what you discussed before, or to find past context. Do not grep filesystem conversation logs.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Full-text query" },
        limit: { type: "number", description: "Maximum results, default 20, max 100" },
      },
      required: ["query"],
    },
    execute: async (args, ctx) => {
      const rows = await ctx.searchConversations(args.query as string, args.limit as number | undefined);
      if (!rows.length) return "No matching prior conversations found.";
      return rows.map((row) => `${row.ts}\t${row.sessionId}\t${row.role}\t${row.snippet}`).join("\n");
    },
  },
  {
    name: "notify_owner",
    description: "Send an attention notification to this user's subscribed my-ax installed apps. Use only when the user explicitly asks to be notified, or for a completed/background task or important action requiring their attention. Never use for routine chat replies. Delivery is always restricted to the current owner.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["session.update", "job.complete", "job.needs_input", "watch.fired", "deploy.gate"], description: "Why the user needs attention" },
        title: { type: "string", description: "Short notification title" },
        body: { type: "string", description: "Short notification body; no secrets" },
        href: { type: "string", description: "Optional same-origin app deep link" },
      },
      required: ["kind", "title", "body"],
    },
    execute: async (args, ctx) => {
      const receipt = await ctx.notifyOwner({
        kind: args.kind as "session.update" | "job.complete" | "job.needs_input" | "watch.fired" | "deploy.gate",
        title: args.title as string,
        body: args.body as string,
        href: args.href as string | undefined,
      });
      const failures = receipt.failures?.length
        ? `; failure details: ${receipt.failures.map((f) => `${f.host}${f.status ? ` ${f.status}` : ""} ${f.reason}`.trim()).join(", ")}`
        : "";
      return `Notification delivery: ${receipt.delivered}/${receipt.devices} device(s) accepted${receipt.expired ? `; ${receipt.expired} expired subscription(s) removed` : ""}${receipt.failed ? `; ${receipt.failed} failed` : ""}${failures}.`;
    },
  },
  {
    name: "create_svelte_artifact",
    description: "Create one durable interactive Svelte 5 artifact attached to this conversation and rendered inline in chat. Use when the user asks for a widget, visualization, dashboard, interactive explainer, calculator, or other useful UI artifact. Each call creates a new one-off artifact: do not treat this as a revision workflow. Source must be a complete self-contained .svelte component using Svelte 5 runes and no external imports. The artifact runs in a sandboxed iframe with no owner credentials; only the Svelte runtime module CDN required to mount it is permitted.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short human-readable artifact title" },
        source: { type: "string", description: "Complete self-contained Svelte 5 component source; no external imports" },
      },
      required: ["title", "source"],
    },
    execute: async (args, ctx) => JSON.stringify(await ctx.createSvelteArtifact({ title: args.title as string, source: args.source as string })),
  },
];

/**
 * Expose the existing my-ax domain tools through the AI SDK execution shape
 * expected by Think. Tool semantics remain unchanged; this adapter is the
 * bridge that lets the new runtime use the same Sandbox and connector code.
 */
export function createThinkTools(context: () => ToolContext): ToolSet {
  const tools: Record<string, Tool<Record<string, unknown>, string>> = {};
  for (const definition of TOOLS) {
    tools[definition.name] = tool<Record<string, unknown>, string>({
      description: definition.description,
      inputSchema: jsonSchema<Record<string, unknown>>(definition.parameters as Parameters<typeof jsonSchema>[0]),
      execute: async (input: Record<string, unknown>) =>
        limitModelToolOutput(await definition.execute(input ?? {}, context())),
    });
  }
  return tools as ToolSet;
}

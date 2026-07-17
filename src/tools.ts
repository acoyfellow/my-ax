import { jsonSchema, tool, type Tool, type ToolSet } from "ai";
import type { ToolDef, ToolContext } from "./types";
import { createDecision } from "./routes/decisions";
import { WORK_CODE_TOOL, WORK_SEARCH_TOOL } from "./work-tools";
import { JobService } from "./job-service";
import type { RecurringJobThreadMode } from "./jobs";
import { limitModelToolOutput } from "./tool-output-limit";
import { getConversationStarters, setConversationStarters } from "./conversation-starters";

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
    description: "List, create, update, pause, resume, run, delete, or inspect history for this owner's recurring prompt jobs. When creating a job from a conversation, omit sessionId to attach it to this current conversation; do not guess a prior session id for 'here'. threadMode controls the destination each run: 'new_session_per_run' (a new thread each run), 'same_session' (this thread), or 'specific_session' (a specific thread whose id you must pass in sessionId).",
    parameters: { type: "object", properties: { action: { type: "string", enum: ["list", "create", "update", "pause", "resume", "run", "delete", "history"] }, id: { type: "string" }, sessionId: { type: "string", description: "Target session id. For create, omit to use the current conversation. Required when threadMode is 'specific_session'." }, threadMode: { type: "string", enum: ["new_session_per_run", "same_session", "specific_session"], description: "Run destination. specific_session requires a valid owned sessionId." }, name: { type: "string" }, prompt: { type: "string" }, cadenceSecs: { type: "number" }, idempotencyKey: { type: "string" } }, required: ["action"] },
    execute: async (args, ctx) => {
      const jobs = new JobService(ctx.env, ctx.identity.email);
      const id = typeof args.id === "string" ? args.id : "";
      const action = args.action;
      const threadMode = typeof args.threadMode === "string" ? args.threadMode as RecurringJobThreadMode : undefined;
      // A Specific thread must use the explicitly-provided id; never silently
      // substitute the current conversation. Only new/this thread create falls
      // back to ctx.sessionId.
      const explicitSessionId = typeof args.sessionId === "string" && args.sessionId.trim() ? args.sessionId : undefined;
      const sessionId = explicitSessionId ?? (action === "create" && threadMode !== "specific_session" ? ctx.sessionId : undefined);
      const input = { sessionId, threadMode, name: args.name as string | undefined, prompt: args.prompt as string | undefined, cadenceSecs: args.cadenceSecs as number | undefined };
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
        kind: { type: "string", enum: ["session.update", "job.complete", "job.needs_input", "watch.fired", "deploy.gate", "recipe.approval"], description: "Why the user needs attention" },
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
    description: "Create one durable interactive Svelte 5 artifact attached to this conversation and rendered inline in chat. Use when the user asks for a widget, visualization, dashboard, interactive explainer, calculator, form, or other useful UI artifact. Each call creates a new one-off artifact: do not treat this as a revision workflow. Source must be a complete self-contained .svelte component using Svelte 5 runes and no external imports. The artifact runs in a sandboxed iframe with no owner credentials; only the Svelte runtime module CDN required to mount it is permitted. TO SEND A RESULT BACK TO THE CHAT (e.g. a submitted form answer), call `window.parent.postMessage({ type: 'my-ax:artifact-submit', value: '<text to place in the composer>', send: false }, '*')`. The value lands in the message composer for the user to review and send; pass `send: true` only to submit it immediately on the user's behalf. This is the only channel out of the sandbox.",
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
  {
    name: "send_voice_message",
    description: "Generate a short spoken audio clip (text-to-speech) and deliver it to the owner as an inline audio player in this conversation, plus a push notification deep-linking here. Use when a spoken message is more natural than text — a summary to listen to, an audible heads-up, or when the user asks you to 'say' or 'read' something aloud. Keep clips under a minute (roughly 1000 characters). Each call creates one new clip.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to speak. Keep it under ~1000 characters (under a minute of speech). No secrets." },
        voice: { type: "string", enum: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"], description: "Optional TTS voice. Defaults to alloy." },
      },
      required: ["text"],
    },
    execute: async (args, ctx) => JSON.stringify(await ctx.sendVoiceMessage({ text: args.text as string, voice: args.voice as string | undefined })),
  },
  {
    name: "manage_starters",
    description: "List or replace the owner's conversation starters — the suggestion cards shown when starting a new conversation. Use when the owner asks to change, add, remove, or reset their starters (e.g. 'make my starters about X, Y, Z'). action 'list' returns the current starters; action 'set' replaces the whole list with the provided starters (each { title, prompt, hint? }); an empty set resets to defaults. Owner-scoped and synced across devices.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "set"] },
        starters: { type: "array", description: "For set: the full replacement list.", items: { type: "object", properties: { title: { type: "string" }, prompt: { type: "string" }, hint: { type: "string" } }, required: ["title", "prompt"] } },
      },
      required: ["action"],
    },
    execute: async (args, ctx) => {
      const email = ctx.identity.email;
      if (args.action === "set") {
        const starters = await setConversationStarters(ctx.env, email, args.starters);
        return JSON.stringify({ ok: true, action: "set", starters });
      }
      const starters = await getConversationStarters(ctx.env, email);
      return JSON.stringify({ ok: true, action: "list", starters });
    },
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

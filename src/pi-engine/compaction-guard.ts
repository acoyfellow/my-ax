import type { Message } from "@earendil-works/pi-ai";
import { AgentDoc, CompactionTask, defineExtension, hook, type HookApi } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import { SUMMARY_MAX_TOKENS } from "./compaction-policy";

export const FIRST_MESSAGE_CAP = 800;
export const TRUNCATION_MARKER = "\n[... truncated]";
const OPEN_TAG = "<myax-first-user-message>";
const CLOSE_TAG = "</myax-first-user-message>";
const HARNESS_SUMMARY_LEAD = "The conversation history before this point was compacted";
const TOOL_RESULT_CAP = 2000;

export const PRESERVATION_INSTRUCTIONS = [
  "Always preserve, in this order and without paraphrasing where exact wording matters:",
  "(a) The user's first message / original request, quoted verbatim in the Goal section.",
  "(b) The overarching goal and every constraint or preference the user stated.",
  "(c) Key decisions made with their rationale, exact file paths, commit hashes, identifiers, error messages, and all open items or next steps.",
  "Never drop these in favour of recent detail.",
].join("\n");

function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

export function capVerbatim(text: string, cap: number = FIRST_MESSAGE_CAP): string {
  if (text.length <= cap) return text;
  let end = cap;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}${TRUNCATION_MARKER}`;
}

export function extractPreservedBlock(text: string): string | undefined {
  const start = text.indexOf(OPEN_TAG);
  if (start < 0) return undefined;
  const from = start + OPEN_TAG.length;
  const end = text.lastIndexOf(CLOSE_TAG);
  if (end < from) return undefined;
  return text.slice(from, end).replace(/^\n/, "").replace(/\n$/, "");
}

export function findFirstUserMessage(messages: readonly Message[]): string | undefined {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = messageText(message);
    const preserved = extractPreservedBlock(text);
    if (preserved !== undefined) return preserved;
    if (text.startsWith(HARNESS_SUMMARY_LEAD)) continue;
    if (text.trim().length === 0) continue;
    return capVerbatim(text);
  }
  return undefined;
}

export function buildCompactionInstructions(firstMessage: string | undefined, existing?: string): string {
  const parts = [PRESERVATION_INSTRUCTIONS];
  if (firstMessage !== undefined) parts.push(`The first user message, verbatim:\n${OPEN_TAG}\n${firstMessage}\n${CLOSE_TAG}`);
  if (existing !== undefined && existing.trim().length > 0) parts.push(existing.trim());
  return parts.join("\n\n");
}

export function preservedBlock(firstMessage: string): string {
  return `## Original Request (verbatim)\n${OPEN_TAG}\n${firstMessage}\n${CLOSE_TAG}`;
}

export function guardSummary(summary: string, firstMessage: string | undefined): string {
  if (firstMessage === undefined) return summary;
  const existing = extractPreservedBlock(summary);
  if (existing === firstMessage) return summary;
  return `${preservedBlock(firstMessage)}\n\n${summary}`;
}

export function serializeForSummary(messages: readonly Message[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === "user") parts.push(`[User]: ${messageText(message)}`);
    else if (message.role === "toolResult") parts.push(`[Tool result]: ${messageText(message).slice(0, TOOL_RESULT_CAP)}`);
    else if (message.role === "assistant") {
      const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
      const calls = message.content.flatMap((block) => (block.type === "toolCall" ? [`${block.name}(${JSON.stringify(block.arguments)})`] : []));
      if (text) parts.push(`[Assistant]: ${text}`);
      if (calls.length > 0) parts.push(`[Assistant tool calls]: ${calls.join("; ")}`);
    }
  }
  return parts.join("\n\n");
}

const SUMMARY_SYSTEM_PROMPT = "You are a context summarization assistant. Read the conversation and output ONLY a structured summary. Do NOT continue the conversation or answer questions in it.";

const SUMMARY_FORMAT = `Create a structured context checkpoint summary another LLM will use to continue the work. If the conversation starts with an earlier summary, preserve its information and fold newer messages into it.

Use this EXACT format:

## Goal
## Constraints & Preferences
## Progress
### Done
### In Progress
### Blocked
## Key Decisions
## Next Steps
## Critical Context

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

export function summarizerPrompt(messages: readonly Message[], instructions: string): string {
  return `<conversation>\n${serializeForSummary(messages)}\n</conversation>\n\n${SUMMARY_FORMAT}\n\nAdditional focus: ${instructions}`;
}

type CompactionInput = Parameters<NonNullable<Parameters<typeof hook<typeof CompactionTask>>[1]["beforeCompact"]>>[0];

async function summarize(compaction: CompactionInput, api: HookApi, context: Context, instructions: string): Promise<string | undefined> {
  const agent = await api.snapshot(AgentDoc, api.conversationId, context);
  const ref = agent?.model;
  if (ref === undefined) return undefined;
  const model = api.models.getModel(ref.provider, ref.modelId);
  if (model === undefined) return undefined;
  const now = api.now();
  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: summarizerPrompt(compaction.messages, instructions) }], timestamp: now }];
  const maxTokens = Math.min(SUMMARY_MAX_TOKENS, model.maxTokens > 0 ? model.maxTokens : SUMMARY_MAX_TOKENS);
  const reply = await api.models.completeSimple(model, { systemPrompt: SUMMARY_SYSTEM_PROMPT, messages }, { maxTokens, cacheRetention: "none" });
  if (reply.stopReason !== "stop" || reply.content.some((block) => block.type === "toolCall")) return undefined;
  const text = reply.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n").trim();
  return text.length === 0 ? undefined : text;
}

export function compactionQualityExtension() {
  return defineExtension({
    name: "myax.compaction-quality",
    hooks: [
      hook(CompactionTask, {
        beforeCompact: async (compaction, api, context) => {
          const first = findFirstUserMessage(compaction.messages);
          if (first === undefined) return undefined;
          const instructions = buildCompactionInstructions(first, compaction.instructions);
          const summary = await summarize(compaction, api, context, instructions);
          if (summary === undefined) return undefined;
          return { summary: guardSummary(summary, first) };
        },
      }),
    ],
  });
}

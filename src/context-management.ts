import type { Message } from "@earendil-works/pi-ai";
import type { CompactionSettings } from "@earendil-works/pi-durable";
import {
  LARGE_WINDOW_COMPACT_AT_TOKENS,
  LARGE_WINDOW_KEEP_RECENT_TOKENS,
  SUMMARY_MAX_TOKENS,
  piCompactionSettings,
  type WindowedModel,
} from "./pi-engine/compaction-policy";

export type ContextPolicySettings = {
  autoCompact: boolean | null;
  compactAtTokens: number | null;
  keepRecentTokens: number | null;
  preserveFirstMessage: boolean | null;
  compactionNotes: string | null;
};

export type EffectiveContextPolicy = {
  autoCompact: boolean;
  compactAtTokens: number;
  keepRecentTokens: number;
  preserveFirstMessage: boolean;
  compactionNotes: string | null;
};

export type ContextBuckets = { summary: number; user: number; assistant: number; tools: number };

export type ContextTopEntry = { id: number; kind: string; label: string; preview: string; tokens: number };

export type ContextSnapshot = {
  model: string;
  activeTokens: number;
  compactAtTokens: number;
  contextWindow: number;
  percentOfCompact: number;
  buckets: ContextBuckets;
  topEntries: ContextTopEntry[];
  headSummary: { entryId: number; text: string; tokens: number } | null;
  activeEntryCount: number;
  totalEntryCount: number;
  compactionCount: number;
  compacting: boolean;
  policy: ContextPolicySettings;
  effectivePolicy: EffectiveContextPolicy;
};

export type ContextSummary = {
  activeTokens: number;
  compactAtTokens: number;
  percentOfCompact: number;
  compacting: boolean;
  compactionCount: number;
};

export type ContextViewInput = {
  head: { id: number; kind: string } | undefined;
  entries: ReadonlyArray<{ id: number; kind: string }>;
  contributions: ReadonlyArray<readonly Message[]>;
  messages: readonly Message[];
};

export type ContextSnapshotInput = {
  model: string;
  contextWindow: number;
  policy: ContextPolicySettings;
  contextView: ContextViewInput;
  totalEntries: number;
  compactionCount: number;
  compacting: boolean;
};

export const MIN_COMPACT_AT_TOKENS = 16_000;
export const MAX_COMPACT_AT_TOKENS = 900_000;
export const MIN_KEEP_RECENT_TOKENS = 4_000;
export const MAX_KEEP_RECENT_TOKENS = 120_000;
export const MAX_COMPACTION_NOTES_LENGTH = 1_500;

const COMPACTION_ENTRY_KIND = "pi.compaction";
const SUMMARY_RESERVE_FLOOR = Math.ceil(SUMMARY_MAX_TOKENS / 0.8);
const DEFAULT_RESERVE_TOKENS = 16_384;
const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
const PREVIEW_LENGTH = 90;
const TOP_ENTRY_COUNT = 5;

export function defaultContextPolicy(): ContextPolicySettings {
  return { autoCompact: null, compactAtTokens: null, keepRecentTokens: null, preserveFirstMessage: null, compactionNotes: null };
}

function clampedInteger(raw: unknown, min: number, max: number): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

function booleanOrNull(raw: unknown): boolean | null {
  return typeof raw === "boolean" ? raw : null;
}

function sanitizeNotes(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_COMPACTION_NOTES_LENGTH) return null;
  return trimmed;
}

export function sanitizeContextPolicy(raw: unknown): ContextPolicySettings {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    autoCompact: booleanOrNull(source.autoCompact),
    compactAtTokens: clampedInteger(source.compactAtTokens, MIN_COMPACT_AT_TOKENS, MAX_COMPACT_AT_TOKENS),
    keepRecentTokens: clampedInteger(source.keepRecentTokens, MIN_KEEP_RECENT_TOKENS, MAX_KEEP_RECENT_TOKENS),
    preserveFirstMessage: booleanOrNull(source.preserveFirstMessage),
    compactionNotes: sanitizeNotes(source.compactionNotes),
  };
}

export function hasContextOverrides(policy: ContextPolicySettings): boolean {
  return Object.values(policy).some((value) => value !== null);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "thinking") return block.thinking;
      if (block.type === "toolCall") return `${block.name}(${JSON.stringify(block.arguments)})`;
      return "[image]";
    })
    .join("\n");
}

function messagesTokens(messages: readonly Message[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(messageText(message)), 0);
}

function defaultCompactAt(contextWindow: number): number {
  if (contextWindow > LARGE_WINDOW_COMPACT_AT_TOKENS * 2) return LARGE_WINDOW_COMPACT_AT_TOKENS;
  return contextWindow - DEFAULT_RESERVE_TOKENS;
}

function resolveCompactAt(contextWindow: number, policy: ContextPolicySettings): number {
  const requested = policy.compactAtTokens ?? defaultCompactAt(contextWindow);
  return Math.max(1, Math.min(requested, contextWindow - SUMMARY_RESERVE_FLOOR));
}

function resolveKeepRecent(contextWindow: number, policy: ContextPolicySettings): number {
  if (policy.keepRecentTokens !== null) return policy.keepRecentTokens;
  return contextWindow > LARGE_WINDOW_COMPACT_AT_TOKENS * 2 ? LARGE_WINDOW_KEEP_RECENT_TOKENS : DEFAULT_KEEP_RECENT_TOKENS;
}

export function resolveContextPolicy(contextWindow: number, policy: ContextPolicySettings): EffectiveContextPolicy {
  return {
    autoCompact: policy.autoCompact ?? true,
    compactAtTokens: resolveCompactAt(contextWindow, policy),
    keepRecentTokens: resolveKeepRecent(contextWindow, policy),
    preserveFirstMessage: policy.preserveFirstMessage ?? true,
    compactionNotes: policy.compactionNotes,
  };
}

export function compactionSettingsWithOverride(models: readonly WindowedModel[], policy: ContextPolicySettings | undefined): CompactionSettings {
  const base = piCompactionSettings(models);
  if (!policy || !hasContextOverrides(policy)) return base;
  const modelOverrides: Record<string, Record<string, number>> = {};
  for (const model of models) {
    const key = `${model.provider}/${model.id}`;
    const existing = (base.modelOverrides?.[key] ?? {}) as Record<string, number>;
    const next = { ...existing };
    if (policy.compactAtTokens !== null) next.reserveTokens = model.contextWindow - resolveCompactAt(model.contextWindow, policy);
    if (policy.keepRecentTokens !== null) next.keepRecentTokens = policy.keepRecentTokens;
    if (Object.keys(next).length > 0) modelOverrides[key] = next;
  }
  return {
    ...base,
    enabled: policy.autoCompact ?? base.enabled,
    keepRecentTokens: policy.keepRecentTokens ?? base.keepRecentTokens,
    modelOverrides,
  };
}

function singleLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
}

function entryLabel(kind: string, messages: readonly Message[]): string {
  if (kind === COMPACTION_ENTRY_KIND) return "Summary";
  const first = messages[0];
  if (!first) return kind;
  if (first.role === "toolResult") return `Tool · ${first.toolName}`;
  if (first.role === "assistant") return "Assistant";
  return "User";
}

function bucketOf(message: Message, isSummary: boolean): keyof ContextBuckets {
  if (isSummary) return "summary";
  if (message.role === "toolResult") return "tools";
  return message.role === "assistant" ? "assistant" : "user";
}

function computeBuckets(view: ContextViewInput): ContextBuckets {
  const buckets: ContextBuckets = { summary: 0, user: 0, assistant: 0, tools: 0 };
  const headIsSummary = view.head?.kind === COMPACTION_ENTRY_KIND;
  view.messages.forEach((message, index) => {
    buckets[bucketOf(message, headIsSummary && index === 0)] += estimateTokens(messageText(message));
  });
  return buckets;
}

function computeTopEntries(view: ContextViewInput): ContextTopEntry[] {
  return view.entries
    .map((entry, index) => {
      const messages = view.contributions[index] ?? [];
      return {
        id: entry.id,
        kind: entry.kind,
        label: entryLabel(entry.kind, messages),
        preview: singleLine(messages.map(messageText).join(" ")),
        tokens: messagesTokens(messages),
      };
    })
    .filter((entry) => entry.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, TOP_ENTRY_COUNT);
}

function computeHeadSummary(view: ContextViewInput): ContextSnapshot["headSummary"] {
  if (view.head?.kind !== COMPACTION_ENTRY_KIND) return null;
  const message = view.messages[0];
  if (!message) return null;
  const text = messageText(message);
  return { entryId: view.head.id, text, tokens: estimateTokens(text) };
}

export function buildContextSnapshot(input: ContextSnapshotInput): ContextSnapshot {
  const effectivePolicy = resolveContextPolicy(input.contextWindow, input.policy);
  const activeTokens = messagesTokens(input.contextView.messages);
  return {
    model: input.model,
    activeTokens,
    compactAtTokens: effectivePolicy.compactAtTokens,
    contextWindow: input.contextWindow,
    percentOfCompact: Math.min(100, Math.round((activeTokens / Math.max(1, effectivePolicy.compactAtTokens)) * 100)),
    buckets: computeBuckets(input.contextView),
    topEntries: computeTopEntries(input.contextView),
    headSummary: computeHeadSummary(input.contextView),
    activeEntryCount: input.contextView.entries.length,
    totalEntryCount: input.totalEntries,
    compactionCount: input.compactionCount,
    compacting: input.compacting,
    policy: input.policy,
    effectivePolicy,
  };
}

export function summarizeSnapshot(snapshot: ContextSnapshot): ContextSummary {
  return {
    activeTokens: snapshot.activeTokens,
    compactAtTokens: snapshot.compactAtTokens,
    percentOfCompact: snapshot.percentOfCompact,
    compacting: snapshot.compacting,
    compactionCount: snapshot.compactionCount,
  };
}

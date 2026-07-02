// tool-id-sanitize.ts — normalize tool-call/tool-result ids before they reach
// a model provider.
//
// Why this exists: a stored conversation can carry a tool-call id that a strict
// provider rejects. Anthropic requires every `tool_use.id` /
// `tool_result.tool_use_id` to match `^[a-zA-Z0-9_-]+$`, but other providers
// (Workers AI, some gateways) emit ids with dots, colons, slashes, or even an
// empty string. When a session created/continued on one provider is later
// replayed to Anthropic — a model switch, a fork, or just resuming — the whole
// history is rejected with e.g.
//   messages.17.content.1.tool_use.id: String should match pattern '^[a-zA-Z0-9_-]+$'
// and the session becomes impossible to return to.
//
// We heal on send: rewrite every offending id to a conforming one, applying the
// SAME deterministic transform to a tool-call and its matching tool-result so
// the pair stays linked. This is provider-agnostic and idempotent (a valid id
// is returned unchanged), so it also repairs already-corrupted sessions the
// next time they are assembled for a turn — no datastore surgery required.

import type { ModelMessage } from "ai";

/** Anthropic's id grammar — the strictest across our providers. */
const MAX_TOOL_ID_LENGTH = 64;
const VALID_TOOL_ID = /^[a-zA-Z0-9_-]+$/;
const INVALID_CHAR = /[^a-zA-Z0-9_-]/g;

/** True when `id` is already accepted by every provider we route to. */
export function isValidToolCallId(id: unknown): id is string {
  return typeof id === "string" && id.length <= MAX_TOOL_ID_LENGTH && VALID_TOOL_ID.test(id);
}

/**
 * Map any tool-call id to a conforming one. Deterministic: the same input
 * always yields the same output, so a tool-call and its tool-result — which
 * share the id — remain paired after rewriting. Illegal characters are escaped
 * (not collapsed) to preserve uniqueness between otherwise-distinct ids; an
 * empty/non-string id falls back to a fixed token.
 */
export function sanitizeToolCallId(id: unknown): string {
  if (isValidToolCallId(id)) return id;
  const escaped = typeof id === "string" ? id.replace(INVALID_CHAR, (ch) => `_${ch.charCodeAt(0).toString(16)}_`) : "";
  const normalized = escaped.length ? escaped : "toolcall_unknown";
  if (normalized.length <= MAX_TOOL_ID_LENGTH) return normalized;
  const suffix = `_${fnv1a32Hex(normalized)}`;
  return `${normalized.slice(0, MAX_TOOL_ID_LENGTH - suffix.length)}${suffix}`;
}

function fnv1a32Hex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Return `messages` with every tool-call/tool-result id normalized. The input
 * array is not mutated; when nothing changes the original reference is returned
 * so callers can cheaply detect a no-op. `onChange` is invoked once per rewrite
 * for observability.
 */
export function sanitizeToolCallIds(
  messages: ModelMessage[],
  onChange?: (before: string, after: string) => void,
): ModelMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    let msgChanged = false;
    const content = (message.content as Array<Record<string, unknown>>).map((part) => {
      if (
        (part?.type === "tool-call" || part?.type === "tool-result") &&
        typeof part.toolCallId === "string" &&
        !isValidToolCallId(part.toolCallId)
      ) {
        const after = sanitizeToolCallId(part.toolCallId);
        onChange?.(part.toolCallId, after);
        msgChanged = true;
        changed = true;
        return { ...part, toolCallId: after };
      }
      return part;
    });
    return msgChanged ? ({ ...message, content } as ModelMessage) : message;
  });
  return changed ? next : messages;
}

// Pure affordance classification for Attention inbox "Recent pings" (#9).
//
// After the rate-limit fixes, a persistently rate-limited owner gets one
// coalesced heads-up per hour ("My AX: paused on rate limit …will retry
// automatically"). In the inbox it looked like any other ping. This classifies
// each item so a rate-limit ping reads as a benign, self-healing "Retrying"
// state, actionable kinds read as "Needs you", and the rest stay quiet info.
//
// Reuses the SAME isTransientRateLimit rule the server/job-health use, for
// consistent semantics end to end. Kept browser-safe (no server imports).

import { isTransientRateLimit } from "../../src/upstream-rate-limit";

export type AttentionTone = "info" | "retrying" | "attention";
export type AttentionAffordance = { tone: AttentionTone; badge: string | null };

export type AttentionItemInput = {
  kind?: string | null;
  title?: string | null;
  body?: string | null;
};

// Kinds that mean the owner must act. Mirrors ACTIONABLE_NOTIFICATION_KINDS in
// src/notify.ts; kept as a local set so this module stays browser-safe (notify
// pulls in the Effect runtime).
const ACTIONABLE_KINDS = new Set([
  "session.dead",
  "job.needs_input",
  "delegate.needs_input",
  "deploy.gate",
  "recipe.approval",
]);

export function classifyAttentionItem(item: AttentionItemInput): AttentionAffordance {
  const kind = (item.kind ?? "").trim();
  const text = `${item.title ?? ""} ${item.body ?? ""}`;
  // A transient rate-limit heads-up is benign + self-healing.
  if (isTransientRateLimit(text)) return { tone: "retrying", badge: "Retrying" };
  if (ACTIONABLE_KINDS.has(kind)) return { tone: "attention", badge: "Needs you" };
  return { tone: "info", badge: null };
}

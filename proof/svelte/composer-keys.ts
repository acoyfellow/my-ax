// Pure composer key-handling decision (Enter behavior). The Svelte layer owns
// the actual KeyboardEvent, the textarea, and the send call; this module holds
// the testable rule for what an Enter press should DO, given the device.
//
// Product rule: on MOBILE (coarse pointer / touch primary) the composer behaves
// like a chat app — Enter inserts a NEWLINE and never sends; sending is an
// explicit Send action only. On desktop (fine pointer + physical keyboard),
// Enter sends and Shift+Enter inserts a newline (the long-standing behavior).
// In both cases IME composition and Shift+Enter must never trigger a send.

export type ComposerKeyDecision = "send" | "newline" | "ignore";

export interface ComposerKeyInput {
  key: string;
  shiftKey: boolean;
  /** True while an IME composition session is active (or keyCode 229). */
  isComposing: boolean;
  /** True when the UI is mobile-shaped (coarse pointer / touch primary). */
  isMobile: boolean;
}

/**
 * Decide what an Enter keypress in the composer should do.
 *
 * - Non-Enter keys: "ignore" (let the textarea handle them normally).
 * - IME composition in progress: "ignore" (never send mid-composition).
 * - Shift+Enter: always "newline" (insert), on every device.
 * - Mobile + plain Enter: "newline" — Enter must NOT send; Send is explicit.
 * - Desktop + plain Enter: "send".
 *
 * "newline" means: let the textarea insert the newline itself (do not
 * preventDefault). "send" means: preventDefault and submit. "ignore" means:
 * do nothing special.
 */
export function decideComposerKey(input: ComposerKeyInput): ComposerKeyDecision {
  if (input.key !== "Enter") return "ignore";
  if (input.isComposing) return "ignore";
  if (input.shiftKey) return "newline";
  if (input.isMobile) return "newline";
  return "send";
}

/** True when the current environment is mobile-shaped: a coarse primary pointer
 *  (touchscreen) rather than a fine pointer (mouse/trackpad). Falls back to
 *  touch-point count when matchMedia is unavailable. Pure w.r.t. an injected
 *  view, so tests pass a fake; production passes the real window. */
export function isMobileComposer(view: {
  matchMedia?: (q: string) => { matches: boolean };
  maxTouchPoints?: number;
} | undefined = typeof window !== "undefined" ? window : undefined): boolean {
  if (!view) return false;
  try {
    if (typeof view.matchMedia === "function") {
      return view.matchMedia("(pointer: coarse)").matches;
    }
  } catch {
    // fall through to touch-point heuristic
  }
  return (view.maxTouchPoints ?? 0) > 0;
}

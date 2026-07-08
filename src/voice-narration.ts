// Pure tool-call narration for hands-free voice mode (#1 C3).
//
// While the agent works, it should say WHAT it's doing in plain language —
// derived from the tool NAME only, never arguments/code/paths/secrets. This
// module is pure (no I/O) so it can be unit-tested and shared by the server
// voice turn. The server maps its stream's tool events to narration lines via
// toolNarrationPhrase() and rate-limits them with a NarrationThrottle.

/** Friendly, code-free phrase for a tool name. ~8 words max, spoken-friendly. */
export function toolNarrationPhrase(toolName: string): string {
  const name = (toolName || "").toLowerCase();
  const exact: Record<string, string> = {
    work_code: "writing and running some code",
    work_search: "searching the codebase",
    codemode: "running some code",
    machinectl_call: "working on your computer",
    machinectl_code: "working on your computer",
    create_svelte_artifact: "building a small interactive view",
    send_voice_message: "preparing an audio clip",
    search_conversations: "checking our past conversations",
    manage_jobs: "updating your scheduled jobs",
    notify_owner: "sending you a notification",
    ask_user: "waiting for your answer",
    delegate_many: "handing parts off to helper agents",
  };
  if (name in exact) return exact[name];
  // Prefix fallbacks for tool families.
  if (name.startsWith("browser")) return "browsing the web";
  if (name.startsWith("machinectl")) return "working on your computer";
  if (name.startsWith("cmux")) return "steering a workspace";
  if (name.startsWith("delegate")) return "handing off to a helper agent";
  return "running a tool";
}

/**
 * Rate-limits narration so we speak at most one line per `minGapMs` and never
 * repeat the same phrase back-to-back. Pure/deterministic: the caller passes
 * `now`. Returns the phrase to speak, or null to stay quiet.
 */
export class NarrationThrottle {
  #minGapMs: number;
  #lastAt = -Infinity;
  #lastPhrase: string | null = null;

  constructor(minGapMs = 4000) {
    this.#minGapMs = Math.max(0, minGapMs);
  }

  /** Consider narrating for a tool starting at `now`. Returns the phrase to
   *  speak, or null (too soon, or same as the last spoken phrase). */
  consider(toolName: string, now: number): string | null {
    const phrase = toolNarrationPhrase(toolName);
    if (phrase === this.#lastPhrase) return null; // don't repeat consecutive same intent
    if (now - this.#lastAt < this.#minGapMs) return null; // rate limit
    this.#lastAt = now;
    this.#lastPhrase = phrase;
    return phrase;
  }

  /** Reset for a new turn. */
  reset(): void {
    this.#lastAt = -Infinity;
    this.#lastPhrase = null;
  }
}

/** Bounded "still working" check-in policy (#1 C4). Emits a filler line if no
 *  narration/reply has been spoken for `idleMs`, at most once per `idleMs`.
 *  Pure: caller supplies `now` and calls markSpoken() whenever anything is
 *  spoken (narration or reply). */
export class StillWorkingTimer {
  #idleMs: number;
  #lastSpokenAt: number;

  constructor(idleMs = 20000, startAt = 0) {
    this.#idleMs = Math.max(1000, idleMs);
    this.#lastSpokenAt = startAt;
  }

  /** Returns the check-in line if we've been silent >= idleMs, else null.
   *  On returning a line it also resets the idle clock (so the next check-in
   *  is another idleMs away). */
  tick(now: number): string | null {
    if (now - this.#lastSpokenAt >= this.#idleMs) {
      this.#lastSpokenAt = now;
      return "Still working on it.";
    }
    return null;
  }

  /** Record that something was spoken (narration or reply) at `now`. */
  markSpoken(now: number): void {
    this.#lastSpokenAt = now;
  }
}

/** Up-front acknowledgement spoken when a turn is likely to take real work. */
export const WORK_ACK = "On it — I'll talk you through it.";

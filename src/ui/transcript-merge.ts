// transcript-merge.ts — the fix for the large-thread "assistant replies lost" race.
//
// On resume, two transcripts arrive: the durable D1 eager restore (fast, complete)
// and Think's cf_agent_chat_messages replay (authoritative content, but possibly
// COMPACTED or still materializing). The old code did `messages = []` then rebuilt
// from Think alone, so any message D1 had but Think's replay omitted (notably
// assistant replies on a long/compacted thread) vanished from the view.
//
// mergeTranscript merges instead of replacing: Think's version WINS for a message
// present in both (it's authoritative), but a message present only in the existing
// (D1) view is KEPT. Alignment is by id — D1 view ids are `meta.uiMessageId || d1-<n>`
// and Think view ids are `message.id`, and the server sets meta.uiMessageId =
// message.id, so the same logical message shares an id across both sources.

export type MergeableMessage = {
  id: string;
  role: string;
  timestamp?: number;
  // Opaque to the merge; carried through untouched.
  [key: string]: unknown;
};

export type MergeOptions = {
  // When true (Think replay), incoming entries override existing on id collision.
  // The default is what the resume path wants.
  preferIncoming?: boolean;
  // Predicate deciding whether an EXISTING (D1) message that Think's replay OMITTED
  // may be retained. Needed because D1 tool rows render as standalone `system`
  // messages with synthetic `d1-<n>` ids, but Think represents those same tool
  // calls as INLINE parts of assistant messages — so keeping the D1 tool rows on
  // top of Think's replay would DUPLICATE them. Only genuine turns that carry a
  // real ui id (a user/assistant message Think may have compacted away) should be
  // retained. Defaults to keeping everything (pure-merge semantics for tests).
  keepExistingOnlyIf?: (msg: MergeableMessage) => boolean;
};

/**
 * Merge two transcript views by id, keeping messages that exist in only one side.
 *
 * - id in BOTH: `preferIncoming` (default true) keeps the incoming (Think) version.
 * - id only in `existing` (D1-only, e.g. an assistant reply Think compacted away): KEPT.
 * - id only in `incoming`: added.
 *
 * Order: by timestamp ascending (chronological), stable for equal/absent timestamps
 * using first-seen order across [existing, incoming]. This preserves the interleaving
 * a user expects and never reorders equal-timestamp neighbors nondeterministically.
 */
export function mergeTranscript<T extends MergeableMessage>(
  existing: T[],
  incoming: T[],
  options: MergeOptions = {},
): T[] {
  const preferIncoming = options.preferIncoming ?? true;
  const keepExistingOnlyIf = options.keepExistingOnlyIf;

  // A message that exists ONLY in `incoming` is always kept. An existing-only
  // message is kept unless the caller's predicate rejects it (used to drop D1
  // tool/synthetic rows that Think re-materializes inline).
  const incomingIds = new Set(incoming.map((m) => m.id));

  // First-seen order gives a stable tiebreaker for equal timestamps.
  const order = new Map<string, number>();
  let seq = 0;
  const chosen = new Map<string, T>();

  const consider = (msg: T, incomingSide: boolean) => {
    if (!order.has(msg.id)) order.set(msg.id, seq++);
    const prior = chosen.get(msg.id);
    if (prior === undefined) {
      chosen.set(msg.id, msg);
      return;
    }
    // Collision: pick per preference. incomingSide === true means `msg` is from `incoming`.
    if (incomingSide === preferIncoming) chosen.set(msg.id, msg);
  };

  for (const m of existing) {
    if (keepExistingOnlyIf && !incomingIds.has(m.id) && !keepExistingOnlyIf(m)) continue;
    consider(m, false);
  }
  for (const m of incoming) consider(m, true);

  const merged = [...chosen.values()];
  merged.sort((a, b) => {
    const ta = typeof a.timestamp === "number" ? a.timestamp : Number.POSITIVE_INFINITY;
    const tb = typeof b.timestamp === "number" ? b.timestamp : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  });
  return merged;
}

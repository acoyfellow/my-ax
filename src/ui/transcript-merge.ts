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
  // Stable logical id for dedup/ordering. When a view assigns a synthetic
  // per-render `id` (e.g. `${rawId}-replay-N` to avoid Svelte key crashes on a
  // duplicated Think replay), `sourceId` preserves the underlying identity so
  // merges still collapse duplicates and align D1 <-> Think by the real id.
  sourceId?: string;
  // Marks a `timestamp` that was interpolated (not observed). Interpolated
  // values MUST NOT reorder messages ahead of real anchors; they are used only
  // as a tiebreaker after the stable first-seen order.
  timestampInterpolated?: boolean;
  // Opaque to the merge; carried through untouched.
  [key: string]: unknown;
};

const keyOf = (msg: MergeableMessage): string => msg.sourceId ?? msg.id;

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
  const incomingIds = new Set(incoming.map((m) => keyOf(m)));

  // First-seen order gives a stable tiebreaker for equal timestamps.
  const order = new Map<string, number>();
  let seq = 0;
  const chosen = new Map<string, T>();

  const consider = (msg: T, incomingSide: boolean) => {
    const k = keyOf(msg);
    if (!order.has(k)) order.set(k, seq++);
    const prior = chosen.get(k);
    if (prior === undefined) {
      chosen.set(k, msg);
      return;
    }
    const preferred = incomingSide === preferIncoming ? msg : prior;
    const fallback = incomingSide === preferIncoming ? prior : msg;
    // Prefer a REAL (non-interpolated) timestamp from either side over an
    // interpolated one — an interpolated ts must never win when a real anchor
    // is available, else it can drag messages past real neighbors on sort.
    const preferredReal = typeof preferred.timestamp === "number" && !preferred.timestampInterpolated;
    const fallbackReal = typeof fallback.timestamp === "number" && !fallback.timestampInterpolated;
    let merged: T = preferred;
    if (!preferredReal && fallbackReal) {
      merged = { ...preferred, timestamp: fallback.timestamp, timestampInterpolated: false } as T;
    } else if (typeof preferred.timestamp !== "number" && typeof fallback.timestamp === "number") {
      merged = { ...preferred, timestamp: fallback.timestamp, timestampInterpolated: fallback.timestampInterpolated } as T;
    }
    chosen.set(k, merged);
  };

  for (const m of existing) {
    if (keepExistingOnlyIf && !incomingIds.has(keyOf(m)) && !keepExistingOnlyIf(m)) continue;
    consider(m, false);
  }
  for (const m of incoming) consider(m, true);

  const merged = [...chosen.values()];
  merged.sort((a, b) => {
    // PRIMARY: stable first-seen order. Interpolated timestamps can only break
    // ties among neighbors that share a first-seen anchor; they never leapfrog
    // a real anchor. Real timestamps still order across genuinely disjoint sets
    // (they were inserted in that first-seen order to begin with).
    const oa = order.get(keyOf(a)) ?? 0;
    const ob = order.get(keyOf(b)) ?? 0;
    // Only use timestamp when BOTH sides have a REAL (non-interpolated) ts —
    // interpolated values are treated as absent for cross-anchor ordering.
    const aReal = typeof a.timestamp === "number" && !a.timestampInterpolated;
    const bReal = typeof b.timestamp === "number" && !b.timestampInterpolated;
    if (aReal && bReal && a.timestamp !== b.timestamp) return (a.timestamp as number) - (b.timestamp as number);
    if (oa !== ob) return oa - ob;
    // Final tiebreaker: any timestamp (including interpolated) to keep local
    // interleaving stable within a run of same-order-neighbors.
    const ta = typeof a.timestamp === "number" ? a.timestamp : Number.POSITIVE_INFINITY;
    const tb = typeof b.timestamp === "number" ? b.timestamp : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
  return merged;
}

export function fillChronologicalTimestampsWithFlags(values: Array<number | undefined>): {
  values: Array<number | undefined>;
  interpolated: boolean[];
} {
  const filled = fillChronologicalTimestamps(values);
  const interpolated = values.map((v, i) => typeof v !== "number" && typeof filled[i] === "number");
  return { values: filled, interpolated };
}

export function fillChronologicalTimestamps(values: Array<number | undefined>): Array<number | undefined> {
  const filled = [...values];
  let index = 0;

  while (index < filled.length) {
    if (typeof filled[index] === "number") {
      index += 1;
      continue;
    }

    const start = index;
    while (index < filled.length && typeof filled[index] !== "number") index += 1;
    const end = index;
    const previous = start > 0 ? filled[start - 1] : undefined;
    const next = end < filled.length ? filled[end] : undefined;
    const count = end - start;

    for (let offset = 0; offset < count; offset += 1) {
      if (typeof previous === "number" && typeof next === "number" && next > previous) {
        filled[start + offset] = previous + ((next - previous) * (offset + 1)) / (count + 1);
      } else if (typeof previous === "number") {
        filled[start + offset] = previous;
      } else if (typeof next === "number") {
        filled[start + offset] = next;
      }
    }
  }

  return filled;
}

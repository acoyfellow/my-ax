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
  sequence?: number;
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

export function keepDurableTurn(message: MergeableMessage): boolean {
  if (message.role === "user" || message.role === "assistant" || message.role === "error") return true;
  return !String(message.id).startsWith("d1-");
}

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const orderOf = (message: MergeableMessage): number =>
  finiteNumber(message.sequence) ?? finiteNumber(message.timestamp) ?? Number.POSITIVE_INFINITY;

function lastMessageById<T extends MergeableMessage>(messages: T[]): Map<string, T> {
  return new Map(messages.map((message) => [keyOf(message), message]));
}

function compareMessages(
  [leftId, left]: [string, MergeableMessage],
  [rightId, right]: [string, MergeableMessage],
): number {
  const leftOrder = orderOf(left);
  const rightOrder = orderOf(right);
  if (leftOrder < rightOrder) return -1;
  if (leftOrder > rightOrder) return 1;
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
}

function mergeVersions<T extends MergeableMessage>(preferred: T, fallback: T): T {
  const preferredTimestamp = finiteNumber(preferred.timestamp);
  const fallbackTimestamp = finiteNumber(fallback.timestamp);
  const preferredRealTimestamp = preferredTimestamp !== undefined && !preferred.timestampInterpolated;
  const fallbackRealTimestamp = fallbackTimestamp !== undefined && !fallback.timestampInterpolated;
  let merged = preferred;
  if (!preferredRealTimestamp && fallbackRealTimestamp) {
    merged = { ...merged, timestamp: fallbackTimestamp, timestampInterpolated: false } as T;
  } else if (preferredTimestamp === undefined && fallbackTimestamp !== undefined) {
    merged = { ...merged, timestamp: fallbackTimestamp, timestampInterpolated: fallback.timestampInterpolated } as T;
  }
  if (finiteNumber(merged.sequence) === undefined) {
    const fallbackSequence = finiteNumber(fallback.sequence);
    if (fallbackSequence !== undefined) merged = { ...merged, sequence: fallbackSequence } as T;
  }
  return merged;
}

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
 */
export function mergeTranscript<T extends MergeableMessage>(
  existing: T[],
  incoming: T[],
  options: MergeOptions = {},
): T[] {
  const preferIncoming = options.preferIncoming ?? true;
  const incomingById = lastMessageById(incoming);
  const existingById = lastMessageById(existing);
  const chosen = new Map<string, T>();

  for (const [id, message] of existingById) {
    if (!incomingById.has(id) && options.keepExistingOnlyIf && !options.keepExistingOnlyIf(message)) continue;
    chosen.set(id, message);
  }

  for (const [id, incomingMessage] of incomingById) {
    const existingMessage = chosen.get(id);
    if (existingMessage === undefined) {
      chosen.set(id, incomingMessage);
      continue;
    }
    const preferred = preferIncoming ? incomingMessage : existingMessage;
    const fallback = preferIncoming ? existingMessage : incomingMessage;
    chosen.set(id, mergeVersions(preferred, fallback));
  }

  const firstSeen = new Map<string, number>();
  let seen = 0;
  for (const message of existing) {
    const id = keyOf(message);
    if (!firstSeen.has(id)) firstSeen.set(id, seen++);
  }
  for (const message of incoming) {
    const id = keyOf(message);
    if (!firstSeen.has(id)) firstSeen.set(id, seen++);
  }
  return [...chosen.entries()].sort((left, right) => {
    const leftOrder = orderOf(left[1]);
    const rightOrder = orderOf(right[1]);
    const leftTimed = Number.isFinite(leftOrder);
    const rightTimed = Number.isFinite(rightOrder);
    if (leftTimed && rightTimed) return compareMessages(left, right);
    const leftSeen = firstSeen.get(left[0]) ?? 0;
    const rightSeen = firstSeen.get(right[0]) ?? 0;
    if (leftSeen !== rightSeen) return leftSeen - rightSeen;
    return compareMessages(left, right);
  }).map(([, message]) => message);
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
      }
    }
  }

  return filled;
}

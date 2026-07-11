// Fractional indexing for user-defined ordering of pinned conversations.
//
// A rank is a short, lexicographically-sortable string. To insert an item
// between two neighbors we compute a key that sorts strictly between their
// keys — WITHOUT renumbering any siblings. That property is what lets two
// devices reorder concurrently and (usually) commute: each reorder touches
// only the moved row's rank, so non-overlapping moves never collide.
//
// The alphabet is base-62 (0-9, A-Z, a-z) in ASCII order, so plain string
// comparison on the D1 column yields the intended order. Keys never end in the
// first digit ('0') so there is always room to insert before an existing key
// by appending, which keeps the midpoint algorithm total.

export const RANK_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = RANK_DIGITS.length; // 62
const FIRST = RANK_DIGITS[0]; // "0"
const LAST = RANK_DIGITS[BASE - 1]; // "z"

function digit(ch: string): number {
  const i = RANK_DIGITS.indexOf(ch);
  return i < 0 ? 0 : i;
}

/** True when a string is a valid rank: nonempty, all base-62 digits, and does
 *  not end in the first digit (which would be a non-canonical trailing zero). */
export function isValidRank(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  for (const ch of value) if (RANK_DIGITS.indexOf(ch) < 0) return false;
  return value[value.length - 1] !== FIRST;
}

/**
 * Return a rank strictly between `a` and `b` (either may be null for
 * open-ended). Requires a < b when both are provided.
 *
 *   between(null, null)  -> a middle key for the first item
 *   between(null, b)     -> a key before b (new top)
 *   between(a, null)     -> a key after a (new bottom)
 *   between(a, b)        -> a key between a and b
 */
export function between(a: string | null, b: string | null): string {
  // Route every result through a single output guard: a valid boundary rank
  // (e.g. "0"*63 + "1") can force a 65-char key that isValidRank() rejects.
  // Fail closed with an explicit exhaustion error so the caller can rebalance
  // rather than silently persisting a rank its own sanitizer treats as absent.
  const result = betweenRaw(a, b);
  if (result.length > 64) {
    throw new Error(`fractional-index: rank space exhausted between ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  }
  return result;
}

function betweenRaw(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    throw new Error(`fractional-index: expected a < b, got ${JSON.stringify(a)} >= ${JSON.stringify(b)}`);
  }
  const lower = a ?? "";
  const upper = b; // null => unbounded above

  let result = "";
  let i = 0;
  // Walk digit positions, carrying the shared prefix, until we find room for a
  // midpoint digit or must descend another position.
  for (;;) {
    const lo = i < lower.length ? digit(lower[i]) : 0;
    const hi = upper !== null && i < upper.length ? digit(upper[i]) : BASE;
    if (lo === hi) {
      // Digits equal: keep the shared prefix and descend.
      result += RANK_DIGITS[lo];
      i += 1;
      continue;
    }
    const mid = Math.floor((lo + hi) / 2);
    if (mid > lo) {
      // Room for a strict midpoint digit here.
      result += RANK_DIGITS[mid];
      return result;
    }
    // No integer strictly between lo and hi at this position (hi === lo + 1).
    // Keep lo and descend; on the next position `upper` is unbounded (BASE),
    // so a midpoint becomes available. Append the lower digit and continue.
    result += RANK_DIGITS[lo];
    i += 1;
    // From here the upper bound no longer constrains us (we've gone below it),
    // so recurse against an unbounded top.
    return result + betweenRaw(i < lower.length ? lower.slice(i) : null, null);
  }
}

/** Rank for appending a new item AFTER the current last (or first item). */
export function rankAfter(last: string | null): string {
  return between(last, null);
}

/** Rank for inserting a new item BEFORE the current first (or first item). */
export function rankBefore(first: string | null): string {
  return between(null, first);
}

/**
 * Evenly spread `count` ranks across the space. Used to (re)assign ranks to an
 * ordered list — e.g. initial assignment or a rebalance when keys grow long.
 * Deterministic: same count always yields the same sequence.
 */
export function spread(count: number): string[] {
  if (count <= 0) return [];
  const out: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < count; i++) {
    prev = between(prev, null);
    out.push(prev);
  }
  return out;
}

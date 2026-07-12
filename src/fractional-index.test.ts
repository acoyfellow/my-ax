import assert from "node:assert/strict";
import test from "node:test";
import { between, isValidRank, rankAfter, rankBefore, spread } from "./fractional-index";

test("between(null, null) yields a valid mid key", () => {
  const k = between(null, null);
  assert.ok(isValidRank(k), `expected valid rank, got ${k}`);
});

test("between produces a key strictly between its neighbors", () => {
  const a = between(null, null);
  const b = between(a, null);
  assert.ok(a < b, `${a} should sort before ${b}`);
  const mid = between(a, b);
  assert.ok(a < mid && mid < b, `${a} < ${mid} < ${b} must hold`);
});

test("rankBefore inserts a new top; rankAfter inserts a new bottom", () => {
  const first = between(null, null);
  const before = rankBefore(first);
  const after = rankAfter(first);
  assert.ok(before < first, `${before} must sort before ${first}`);
  assert.ok(first < after, `${first} must sort before ${after}`);
});

test("repeated midpoint insertion stays strictly ordered (no collisions)", () => {
  // Keep inserting between the two tightest neighbors; must never collide.
  let lo = between(null, null);
  let hi = between(lo, null);
  const seen = new Set([lo, hi]);
  for (let i = 0; i < 200; i++) {
    const mid = between(lo, hi);
    assert.ok(lo < mid && mid < hi, `iteration ${i}: ${lo} < ${mid} < ${hi}`);
    assert.ok(!seen.has(mid), `iteration ${i}: duplicate key ${mid}`);
    assert.ok(isValidRank(mid), `iteration ${i}: invalid key ${mid}`);
    seen.add(mid);
    hi = mid; // tighten downward toward lo
  }
});

test("spread(n) returns n strictly increasing valid ranks (incl. past the old 385 one-sided limit)", () => {
  const ranks = spread(385);
  assert.equal(ranks.length, 385);
  for (let i = 0; i < ranks.length; i++) {
    assert.ok(isValidRank(ranks[i]), `rank ${i} invalid: ${ranks[i]}`);
    if (i > 0) assert.ok(ranks[i - 1] < ranks[i], `not increasing at ${i}: ${ranks[i - 1]} !< ${ranks[i]}`);
  }
  assert.deepEqual(spread(385), ranks, "spread must be deterministic");
  assert.deepEqual(spread(0), []);
});

test("a full reorder sequence sorts as intended", () => {
  // Start with 4 items A,B,C,D; move D to the top; assert final order.
  const [a, b, c, d] = spread(4);
  const order = [a, b, c, d];
  assert.deepEqual([...order].sort(), order, "spread starts sorted");
  // Move D above A: new rank between null and A.
  const dNew = between(null, a);
  const finalRanks = [
    { id: "D", r: dNew },
    { id: "A", r: a },
    { id: "B", r: b },
    { id: "C", r: c },
  ];
  const sorted = [...finalRanks].sort((x, y) => (x.r < y.r ? -1 : x.r > y.r ? 1 : 0)).map((x) => x.id);
  assert.deepEqual(sorted, ["D", "A", "B", "C"]);
});

test("between rejects inverted bounds", () => {
  const a = between(null, null);
  const b = between(a, null);
  assert.throws(() => between(b, a), /expected a < b/);
  assert.throws(() => between(a, a), /expected a < b/);
});

test("between rejects malformed boundary ranks (fail closed)", () => {
  assert.throws(() => between("A~", "B"), /invalid lower rank/);
  assert.throws(() => between("A", "A!"), /invalid upper rank/);
});

test("isValidRank rejects malformed values", () => {
  assert.equal(isValidRank(""), false);
  assert.equal(isValidRank("A0"), false, "trailing first-digit is non-canonical");
  assert.equal(isValidRank("A!"), false, "non-alphabet char");
  assert.equal(isValidRank(null), false);
  assert.equal(isValidRank(123 as unknown), false);
  assert.equal(isValidRank("A"), true);
  assert.equal(isValidRank("Az"), true);
});

test("adjacent-digit bounds descend without collision", () => {
  // Force the hi === lo + 1 branch: between two adjacent single digits.
  const lo = "A";
  const hi = "B";
  const mid = between(lo, hi);
  assert.ok(lo < mid && mid < hi, `${lo} < ${mid} < ${hi}`);
  assert.ok(isValidRank(mid));
});

test("between fails closed (exhaustion) instead of returning an over-long invalid rank", () => {
  const boundary = `${"0".repeat(63)}1`;
  assert.equal(isValidRank(boundary), true);
  assert.throws(() => rankBefore(boundary), /rank space exhausted/i);
});

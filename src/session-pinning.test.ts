import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "./types";
import { isValidRank } from "./fractional-index";
import {
  computeMoveRank,
  rankForNewPin,
  setSessionPinned,
  reorderPinnedSession,
  MAX_PINNED,
  PinLimitError,
  type PinnedRow,
} from "./session-pinning";

// ── Pure ordering ───────────────────────────────────────────────────────────

function ordered(...ids: Array<[string, string]>): PinnedRow[] {
  return ids.map(([id, pin_rank]) => ({ id, pin_rank }));
}

test("rankForNewPin puts a new pin above the current top", () => {
  const first = rankForNewPin(null);
  assert.ok(isValidRank(first));
  const second = rankForNewPin(first);
  assert.ok(second < first, `${second} must sort before ${first}`);
});

test("computeMoveRank: move to bottom lands after the last row", () => {
  const list = ordered(["a", "A"], ["b", "M"], ["c", "Z"]);
  const rank = computeMoveRank(list, "a", null);
  assert.ok(rank > "Z", `${rank} must sort after last (Z)`);
});

test("computeMoveRank: move before the first row lands at the top", () => {
  const list = ordered(["a", "A"], ["b", "M"], ["c", "Z"]);
  const rank = computeMoveRank(list, "c", "a");
  assert.ok(rank < "A", `${rank} must sort before first (A)`);
});

test("computeMoveRank: move between two rows lands strictly between", () => {
  const list = ordered(["a", "A"], ["b", "M"], ["c", "Z"]);
  // Move c to sit before b => between a(A) and b(M).
  const rank = computeMoveRank(list, "c", "b");
  assert.ok(rank > "A" && rank < "M", `${rank} must be between A and M`);
});

test("computeMoveRank: unknown anchor falls back to top deterministically", () => {
  const list = ordered(["a", "A"], ["b", "M"]);
  const rank = computeMoveRank(list, "a", "does-not-exist");
  assert.ok(rank < "M", "fallback rank sorts above the remaining rows");
});

// ── D1-backed operations ─────────────────────────────────────────────────────

type Row = { id: string; owner_email: string; pinned: number; pin_rank: string | null; updated_at: string };

function makeEnv(rows: Row[]) {
  const tables = { sessions: rows };
  const db = {
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, " ").trim();
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async first<T = unknown>() {
          if (/SELECT id FROM sessions WHERE id = \? AND owner_email = \?/.test(q)) {
            return (tables.sessions.find((r) => r.id === bound[0] && r.owner_email === bound[1]) ?? null) as T;
          }
          return null as T;
        },
        async all<T = unknown>() {
          if (/WHERE owner_email = \? AND pinned = 1/.test(q)) {
            const rows = tables.sessions
              .filter((r) => r.owner_email === bound[0] && r.pinned === 1)
              .sort((a, b) => (a.pin_rank ?? "") < (b.pin_rank ?? "") ? -1 : (a.pin_rank ?? "") > (b.pin_rank ?? "") ? 1 : 0);
            return { results: rows as unknown as T[] };
          }
          return { results: [] as T[] };
        },
        async run() {
          if (/UPDATE sessions SET pinned = 1, pin_rank = \?/.test(q)) {
            const row = tables.sessions.find((r) => r.id === bound[1] && r.owner_email === bound[2]);
            if (row) { row.pinned = 1; row.pin_rank = bound[0] as string; }
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (/UPDATE sessions SET pinned = 0, pin_rank = NULL/.test(q)) {
            const row = tables.sessions.find((r) => r.id === bound[0] && r.owner_email === bound[1]);
            if (row) { row.pinned = 0; row.pin_rank = null; }
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (/UPDATE sessions SET pin_rank = \?,? .* AND pinned = 1/.test(q)) {
            const row = tables.sessions.find((r) => r.id === bound[1] && r.owner_email === bound[2] && r.pinned === 1);
            if (row) row.pin_rank = bound[0] as string;
            return { meta: { changes: row ? 1 : 0 } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db } as unknown as Env, tables };
}

const OWNER = "owner@example.com";

test("setSessionPinned pins to the top and unpins clearing the rank", async () => {
  const { env, tables } = makeEnv([
    { id: "s1", owner_email: OWNER, pinned: 0, pin_rank: null, updated_at: "t1" },
    { id: "s2", owner_email: OWNER, pinned: 0, pin_rank: null, updated_at: "t2" },
  ]);
  const p1 = await setSessionPinned(env, OWNER, "s1", true);
  assert.equal(p1?.pinned, true);
  assert.ok(isValidRank(p1!.pin_rank!));
  const p2 = await setSessionPinned(env, OWNER, "s2", true);
  assert.ok(p2!.pin_rank! < p1!.pin_rank!, "newest pin goes above the previous top");

  const unpin = await setSessionPinned(env, OWNER, "s1", false);
  assert.equal(unpin?.pinned, false);
  assert.equal(unpin?.pin_rank, null);
  assert.equal(tables.sessions.find((r) => r.id === "s1")!.pinned, 0);
});

test("setSessionPinned fails closed for a foreign/missing session", async () => {
  const { env } = makeEnv([{ id: "s1", owner_email: "other@example.com", pinned: 0, pin_rank: null, updated_at: "t1" }]);
  assert.equal(await setSessionPinned(env, OWNER, "s1", true), null);
});

test("reorderPinnedSession moves a pinned row and persists a between rank", async () => {
  const { env, tables } = makeEnv([
    { id: "a", owner_email: OWNER, pinned: 1, pin_rank: "A", updated_at: "t1" },
    { id: "b", owner_email: OWNER, pinned: 1, pin_rank: "M", updated_at: "t2" },
    { id: "c", owner_email: OWNER, pinned: 1, pin_rank: "Z", updated_at: "t3" },
  ]);
  // Move c before b.
  const r = await reorderPinnedSession(env, OWNER, "c", "b");
  assert.ok(r);
  const cRank = tables.sessions.find((x) => x.id === "c")!.pin_rank!;
  assert.ok(cRank > "A" && cRank < "M", `${cRank} must sit between A and M`);
  // Resulting order a, c, b.
  const order = tables.sessions.filter((x) => x.pinned === 1).sort((x, y) => (x.pin_rank! < y.pin_rank! ? -1 : 1)).map((x) => x.id);
  assert.deepEqual(order, ["a", "c", "b"]);
});

test("reorderPinnedSession fails closed when the row is not pinned", async () => {
  const { env } = makeEnv([{ id: "a", owner_email: OWNER, pinned: 0, pin_rank: null, updated_at: "t1" }]);
  assert.equal(await reorderPinnedSession(env, OWNER, "a", null), null);
});

test("last-writer-wins: two moves of the same row leave the last rank", async () => {
  const { env, tables } = makeEnv([
    { id: "a", owner_email: OWNER, pinned: 1, pin_rank: "A", updated_at: "t1" },
    { id: "b", owner_email: OWNER, pinned: 1, pin_rank: "M", updated_at: "t2" },
    { id: "c", owner_email: OWNER, pinned: 1, pin_rank: "Z", updated_at: "t3" },
  ]);
  await reorderPinnedSession(env, OWNER, "c", "a"); // move c to top
  await reorderPinnedSession(env, OWNER, "c", null); // then to bottom (last writer)
  const cRank = tables.sessions.find((x) => x.id === "c")!.pin_rank!;
  assert.ok(cRank > "M", "final rank reflects the last move (bottom)");
});

test("computeMoveRank: moving a row before itself is a stable no-op", () => {
  const list = ordered(["a", "A"], ["b", "M"], ["c", "Z"]);
  assert.equal(computeMoveRank(list, "b", "b"), "M");
});

test("setSessionPinned fails closed at MAX_PINNED for a new pin, but re-pin is idempotent", async () => {
  const rows: Row[] = Array.from({ length: MAX_PINNED }, (_, i) => ({
    id: `p${i}`, owner_email: OWNER, pinned: 1, pin_rank: String.fromCharCode(65 + i), updated_at: `t${i}`,
  }));
  rows.push({ id: "new", owner_email: OWNER, pinned: 0, pin_rank: null, updated_at: "tn" });
  const { env } = makeEnv(rows);
  await assert.rejects(() => setSessionPinned(env, OWNER, "new", true), (e) => e instanceof PinLimitError && e.limit === MAX_PINNED);
  // Re-pinning one that is already pinned does not trip the cap.
  const again = await setSessionPinned(env, OWNER, "p0", true);
  assert.equal(again?.pinned, true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { DeskWriteConflict, writeWithCompareAndSet } from "./desk-write";

type Board = { cards: string[] };

function store(initial: Board) {
  let value: Board = initial;
  let version = 0;
  return {
    peek: () => value,
    versionNow: () => String(version),
    io: {
      read: async () => ({ value, version: String(version) }),
      compareAndSet: async (next: Board, expected: string | null) => {
        if (expected !== String(version)) return false;
        value = next;
        version += 1;
        return true;
      },
    },
    forceWrite: (next: Board) => { value = next; version += 1; },
  };
}

const addCard = (name: string) => (board: Board): Board => ({ cards: [...board.cards, name] });

test("a single writer stores its card in one attempt", async () => {
  const s = store({ cards: [] });
  const out = await writeWithCompareAndSet(s.io, addCard("a"));
  assert.deepEqual(out.value.cards, ["a"]);
  assert.equal(out.attempts, 1);
  assert.deepEqual(s.peek().cards, ["a"]);
});

test("a concurrent writer does not erase the card another agent just wrote", async () => {
  const s = store({ cards: [] });
  let injected = false;
  const io = {
    read: s.io.read,
    compareAndSet: async (next: Board, expected: string | null) => {
      if (!injected) {
        injected = true;
        s.forceWrite({ cards: ["from-other-agent"] });
      }
      return s.io.compareAndSet(next, expected);
    },
  };
  const out = await writeWithCompareAndSet(io, addCard("mine"));
  assert.deepEqual(out.value.cards, ["from-other-agent", "mine"]);
  assert.ok(out.attempts >= 2, "the stale write must be retried, not applied");
  assert.deepEqual(s.peek().cards, ["from-other-agent", "mine"]);
});

test("two interleaved writers both survive", async () => {
  const s = store({ cards: [] });
  await Promise.all([
    writeWithCompareAndSet(s.io, addCard("agent-one")),
    writeWithCompareAndSet(s.io, addCard("agent-two")),
  ]);
  assert.equal(s.peek().cards.length, 2);
  assert.ok(s.peek().cards.includes("agent-one"));
  assert.ok(s.peek().cards.includes("agent-two"));
});

test("a permanently contended write reports a conflict instead of losing data", async () => {
  const io = {
    read: async () => ({ value: { cards: [] } as Board, version: "0" }),
    compareAndSet: async () => false,
  };
  await assert.rejects(() => writeWithCompareAndSet(io, addCard("x")), DeskWriteConflict);
});

test("the retry budget is bounded", async () => {
  let attempts = 0;
  const io = {
    read: async () => { attempts += 1; return { value: { cards: [] } as Board, version: "0" }; },
    compareAndSet: async () => false,
  };
  await assert.rejects(() => writeWithCompareAndSet(io, addCard("x"), 3), DeskWriteConflict);
  assert.equal(attempts, 3);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { compareAndSetBoard, readVersionedBoard, type DeskBoardDb } from "./desk-board-store";
import { upsertDeskCard } from "./desk-board";
import { writeWithCompareAndSet } from "./desk-write";

function sqliteD1(): DeskBoardDb {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE owner_preferences (owner_email TEXT, preference_key TEXT, value_json TEXT, created_at TEXT, updated_at TEXT, PRIMARY KEY (owner_email, preference_key))");
  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async () => (db.prepare(sql).get(...(params as never[])) ?? null),
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(params as never[])).changes) } }),
    }),
  });
  return { DB: { prepare } as unknown as DeskBoardDb["DB"] };
}

function frozenClock<T>(iso: string, run: () => Promise<T>): Promise<T> {
  const original = Date.prototype.toISOString;
  Date.prototype.toISOString = () => iso;
  return run().finally(() => { Date.prototype.toISOString = original; });
}

function upsert(env: DeskBoardDb, card: { id: string; title: string; status: string }) {
  return Effect.runPromise(writeWithCompareAndSet({
    read: () => readVersionedBoard(env, "owner@example.com"),
    compareAndSet: (next, expectedVersion) => compareAndSetBoard(env, "owner@example.com", next, expectedVersion),
  }, (current) => upsertDeskCard(current, card)));
}

test("a write whose expected board is stale is rejected even when the clock has not advanced", async () => {
  const env = sqliteD1();
  await frozenClock("2026-10-09T21:16:27.603Z", async () => {
    await compareAndSetBoard(env, "owner@example.com", upsertDeskCard({ cards: [], updatedAt: "" } as never, { id: "a", title: "A", status: "pending" }), null);
    const writerA = await readVersionedBoard(env, "owner@example.com");
    const writerB = await readVersionedBoard(env, "owner@example.com");
    assert.equal(await compareAndSetBoard(env, "owner@example.com", upsertDeskCard(writerA.value, { id: "a", title: "A", status: "approved" }), writerA.version), true);
    assert.equal(await compareAndSetBoard(env, "owner@example.com", upsertDeskCard(writerB.value, { id: "b", title: "B", status: "approved" }), writerB.version), false);
  });
});

test("six parallel upserts of different cards all land with no conflict error", async () => {
  const env = sqliteD1();
  const ids = ["c0", "c1", "c2", "c3", "c4", "c5"];
  const slowEnv: DeskBoardDb = {
    DB: {
      prepare: (sql: string) => {
        const inner = env.DB.prepare(sql);
        return {
          bind: (...params: unknown[]) => {
            const bound = (inner as unknown as { bind: (...p: unknown[]) => { first: () => Promise<unknown>; run: () => Promise<unknown> } }).bind(...params);
            return {
              first: async () => { const row = await bound.first(); await new Promise((r) => setTimeout(r, 2)); return row; },
              run: async () => { await new Promise((r) => setTimeout(r, 2)); return bound.run(); },
            };
          },
        };
      },
    } as unknown as DeskBoardDb["DB"],
  };
  const results = await Promise.allSettled(ids.map((id) => upsert(slowEnv, { id, title: id, status: "pending" })));
  assert.deepEqual(results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason)), []);
  const { value } = await readVersionedBoard(env, "owner@example.com");
  assert.deepEqual(value.cards.map((card) => card.id).sort(), ids);
});

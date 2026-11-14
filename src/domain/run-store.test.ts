import assert from "node:assert/strict";
import { test } from "node:test";
import { dismissRunRecord, dismissRunRecords, guardedRunTransition, startRunRecord, transitionRunRecord } from "./Run/Run.store";
import { DomainRejected } from "./decide";

function fakeDb(status: string | null, listed: Array<{ id: string; status: string }> = []) {
  const writes: string[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: () => ({
        run: async () => {
          writes.push(sql.trim().split(/\s+/).slice(0, 4).join(" "));
          return { meta: { changes: 1 } };
        },
        first: async <T>() => (status === null ? null : ({ status } as T)),
        all: async <T>() => ({ results: listed as T[] }),
      }),
    }),
  };
  return { db, writes };
}

test("a move Domain refuses never reaches the database", async () => {
  const { db, writes } = fakeDb("completed");
  const applied = await transitionRunRecord(db, "r1", "o@x", "RecordReceipt", guardedRunTransition("running", ["open"], "r1", "o@x"));
  assert.equal(applied, false);
  assert.deepEqual(writes, []);
});

test("a move Domain accepts sends the guarded update", async () => {
  const { db, writes } = fakeDb("open");
  const applied = await transitionRunRecord(db, "r1", "o@x", "RecordReceipt", guardedRunTransition("running", ["open"], "r1", "o@x"));
  assert.equal(applied, true);
  assert.deepEqual(writes, ["UPDATE runs SET status"]);
});

test("a move on a missing run writes nothing", async () => {
  const { db, writes } = fakeDb(null);
  assert.equal(await transitionRunRecord(db, "r1", "o@x", "CompleteRun", guardedRunTransition("completed", ["open", "running"], "r1", "o@x")), false);
  assert.deepEqual(writes, []);
});

test("a new run is started once in the stage asked for", async () => {
  const { db, writes } = fakeDb(null);
  await startRunRecord(db, { id: "r1", ownerEmail: "o@x", sessionId: null, status: "open", title: "t", taskSummary: "s", boundsJson: "{}", createdAt: null });
  await startRunRecord(db, { id: "r2", ownerEmail: "o@x", sessionId: "s1", status: "running", title: "t", taskSummary: "s", boundsJson: "{}", createdAt: "2026-01-01" });
  assert.deepEqual(writes, ["INSERT INTO runs(id, owner_email,", "INSERT INTO runs (id,"]);
});

test("dismissing reports missing runs and dismisses known ones", async () => {
  const missing = fakeDb(null);
  assert.deepEqual(await dismissRunRecord(missing.db, "r1", "o@x"), { found: false, changed: false });
  assert.deepEqual(missing.writes, []);
  const known = fakeDb("failed", [{ id: "r1", status: "failed" }, { id: "r2", status: "open" }]);
  assert.deepEqual(await dismissRunRecord(known.db, "r1", "o@x"), { found: true, changed: true });
  assert.equal(await dismissRunRecords(known.db, "o@x", null), 1);
  assert.deepEqual(known.writes, ["UPDATE runs SET dismissed_at", "UPDATE runs SET dismissed_at"]);
});

test("the guarded update keeps the SQL from-status guard", () => {
  const guarded = guardedRunTransition("completed", ["open", "running"], "r1", "o@x");
  assert.match(guarded.sql, /AND status IN \(\?, \?\)$/);
  assert.deepEqual(guarded.binds, ["completed", "r1", "o@x", "open", "running"]);
  assert.equal(DomainRejected.name, "DomainRejected");
});

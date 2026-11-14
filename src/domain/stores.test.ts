import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainRejected } from "./decide";
import { ensureComputer, recordComputerSnapshot, removeComputer, retitleComputer } from "./Computer/Computer.store";
import { receiveEmailRecord } from "./records";
import { createWidgetRecord, deleteWidgetRecord, setWidgetSourceHash, setWidgetTitle } from "./Widget/Widget.store";

function fakeDb(rowFor: (sql: string) => unknown = () => null) {
  const writes: string[] = [];
  const statement = (sql: string) => ({
    bind: () => ({
      run: async () => {
        writes.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
        return { meta: { changes: 1 } };
      },
      first: async <T>() => rowFor(sql) as T | null,
      all: async <T>() => ({ results: [] as T[] }),
    }),
  });
  const db = {
    prepare: statement,
    batch: async (statements: Array<{ run(): Promise<unknown> }>) => {
      for (const s of statements) await s.run();
    },
  };
  return { db, writes };
}

const widgetRow = { title: "Clock", source_hash: "h1", library_saved: 0 };
const computerKey = { owner: "o@x", computerId: "desk" };

test("a widget is inserted only when Domain accepts CreateWidget", async () => {
  const { db, writes } = fakeDb();
  await createWidgetRecord(db, { id: "w1", owner: "o@x", sessionId: "s", kind: "svelte-widget", title: "Clock", storageKey: "k", sourceHash: "h", createdAt: "t" });
  assert.deepEqual(writes, ["INSERT INTO artifacts"]);
});

test("renaming or re-sourcing a missing widget writes nothing", async () => {
  const { db, writes } = fakeDb();
  assert.equal(await setWidgetTitle(db, "o@x", "w1", "New", "t"), false);
  await setWidgetSourceHash(db, "o@x", "w1", "h2", "t");
  assert.deepEqual(writes, []);
});

test("deleting a missing widget is refused by Domain", async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(deleteWidgetRecord(db, "o@x", "w1"), (error: unknown) => error instanceof DomainRejected && error.rejection._tag === "WidgetNotFound");
  assert.deepEqual(writes, []);
});

test("an existing widget is renamed, re-sourced and deleted", async () => {
  const { db, writes } = fakeDb((sql) => (sql.includes("FROM artifacts") ? widgetRow : null));
  assert.equal(await setWidgetTitle(db, "o@x", "w1", "New", "t"), true);
  await setWidgetSourceHash(db, "o@x", "w1", "h2", "t");
  await deleteWidgetRecord(db, "o@x", "w1");
  assert.deepEqual(writes, ["UPDATE artifacts SET", "UPDATE artifacts SET", "DELETE FROM artifacts"]);
});

test("a new computer is created, an existing one is touched", async () => {
  const fresh = fakeDb();
  await ensureComputer(fresh.db, computerKey, "Desk");
  assert.deepEqual(fresh.writes, ["INSERT INTO computers"]);
  const known = fakeDb((sql) => (sql.includes("FROM computers") ? { title: "Desk" } : null));
  await ensureComputer(known.db, computerKey, "Desk");
  assert.deepEqual(known.writes, ["UPDATE computers SET"]);
});

test("a missing computer cannot be renamed or removed", async () => {
  const { db, writes } = fakeDb();
  assert.equal(await retitleComputer(db, computerKey, "New"), false);
  await assert.rejects(removeComputer(db, computerKey), (error: unknown) => error instanceof DomainRejected && error.rejection._tag === "ComputerNotFound");
  assert.deepEqual(writes, []);
});

test("removing a computer deletes its snapshot and record", async () => {
  const { db, writes } = fakeDb((sql) =>
    sql.includes("FROM computers") ? { title: "Desk" } : sql.includes("FROM computer_snapshots") ? { backup_id: "b", backup_dir: "/h", snapshot_version: 2 } : null,
  );
  await removeComputer(db, computerKey);
  assert.deepEqual(writes, ["DELETE FROM computer_snapshots", "DELETE FROM computers"]);
});

test("a computer snapshot is created first and versioned after", async () => {
  const fresh = fakeDb();
  await recordComputerSnapshot(fresh.db, computerKey, "b1", "/h");
  const known = fakeDb((sql) => (sql.includes("FROM computer_snapshots") ? { backup_id: "b0", backup_dir: "/h", snapshot_version: 4 } : null));
  await recordComputerSnapshot(known.db, computerKey, "b1", "/h");
  assert.deepEqual([...fresh.writes, ...known.writes], ["INSERT INTO computer_snapshots(owner_email,", "INSERT INTO computer_snapshots(owner_email,"]);
});

test("an inbound email is recorded through Domain", async () => {
  const { db, writes } = fakeDb();
  await receiveEmailRecord(db, { id: "e1", owner: "o@x", from: "a@b", to: "o@x", subject: "Hi", body: "Hello" });
  assert.deepEqual(writes, ["INSERT INTO emails"]);
});

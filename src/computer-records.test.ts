import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deleteComputerRecord, getComputerRow, listNamedComputers, recordComputer, renameComputer } from "./computer-records";
import { sqliteD1 } from "./fsm/sqlite-d1";

const SCHEMA = readFileSync(new URL("../migrations/0030_computer_snapshots.sql", import.meta.url), "utf8")
  + readFileSync(new URL("../migrations/0041_computers.sql", import.meta.url), "utf8");

const owner = { email: "Owner@Example.com" };
const other = { email: "other@example.com" };

function fixture() {
  const DB = sqliteD1(SCHEMA);
  return { env: { DB }, DB };
}

test("create, read, rename and delete a computer", async () => {
  const { env, DB } = fixture();
  const created = await recordComputer(env, owner, "Desk-1", "My desk");
  assert.equal(created.computer_id, "desk-1");
  assert.equal(created.title, "My desk");
  assert.equal(created.backup_id, null);

  assert.equal((await listNamedComputers(env, owner)).length, 1);
  assert.equal(await renameComputer(env, owner, "desk-1", "  Work  "), true);
  assert.equal((await getComputerRow(env, owner, "desk-1"))?.title, "Work");

  let destroyed = 0;
  assert.equal(await deleteComputerRecord(DB, owner.email, "desk-1", async () => { destroyed += 1; }), true);
  assert.equal(destroyed, 1);
  assert.deepEqual(await listNamedComputers(env, owner), []);
});

test("opening a computer again keeps its name", async () => {
  const { env } = fixture();
  await recordComputer(env, owner, "desk", "Named");
  const reopened = await recordComputer(env, owner, "desk");
  assert.equal(reopened.title, "Named");
});

test("a new computer with no name uses its id", async () => {
  const { env } = fixture();
  assert.equal((await recordComputer(env, owner, "lab")).title, "lab");
});

test("delete also drops the snapshot, so a new computer with the same id starts empty", async () => {
  const { env, DB } = fixture();
  await recordComputer(env, owner, "desk");
  DB.raw.prepare("INSERT INTO computer_snapshots VALUES ('owner@example.com','desk','b1','/home/user',1,'t','t')").run();
  assert.equal((await getComputerRow(env, owner, "desk"))?.backup_id, "b1");
  await deleteComputerRecord(DB, owner.email, "desk", async () => undefined);
  await recordComputer(env, owner, "desk");
  assert.equal((await getComputerRow(env, owner, "desk"))?.backup_id, null);
});

test("a failed container destroy still deletes the record", async () => {
  const { env, DB } = fixture();
  await recordComputer(env, owner, "desk");
  assert.equal(await deleteComputerRecord(DB, owner.email, "desk", async () => { throw new Error("container gone"); }), true);
  assert.equal(await getComputerRow(env, owner, "desk"), null);
});

test("another owner cannot see, rename or delete my computer", async () => {
  const { env, DB } = fixture();
  await recordComputer(env, owner, "desk");
  assert.deepEqual(await listNamedComputers(env, other), []);
  assert.equal(await renameComputer(env, other, "desk", "stolen"), false);
  let destroyed = 0;
  assert.equal(await deleteComputerRecord(DB, other.email, "desk", async () => { destroyed += 1; }), false);
  assert.equal(destroyed, 0);
  assert.equal((await getComputerRow(env, owner, "desk"))?.title, "desk");
});

test("bad ids and empty names are refused", async () => {
  const { env } = fixture();
  await assert.rejects(recordComputer(env, owner, "../etc"));
  await recordComputer(env, owner, "desk");
  await assert.rejects(renameComputer(env, owner, "desk", "   "));
});

test("the migration copies computers that already have a snapshot", () => {
  const DB = sqliteD1(readFileSync(new URL("../migrations/0030_computer_snapshots.sql", import.meta.url), "utf8"));
  DB.raw.prepare("INSERT INTO computer_snapshots VALUES ('owner@example.com','old','b1','/home/user',1,'t1','t2')").run();
  DB.raw.exec(readFileSync(new URL("../migrations/0041_computers.sql", import.meta.url), "utf8"));
  const row = DB.raw.prepare("SELECT computer_id, title FROM computers").get();
  assert.deepEqual({ ...row }, { computer_id: "old", title: "old" });
});

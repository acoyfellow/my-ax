import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sqliteD1 } from "./fsm/sqlite-d1";
import {
  admitMachine,
  approveMachine,
  forgetMachine,
  listMachines,
  logOutAllMachines,
  logOutMachine,
  machineHostKey,
  normalizeMachineName,
  renameMachine,
} from "./machine-pairing";

const schema = ["0045_machines.sql", "0046_machine_titles.sql", "0047_machine_access.sql"]
  .map((file) => readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"))
  .join("\n");
const owner = "Owner@Example.com";
const freshDb = () => sqliteD1(schema) as unknown as D1Database;

test("a machine that signs in for the first time waits for approval and is not admitted", async () => {
  const db = freshDb();
  assert.deepEqual(await admitMachine(db, owner, "air", 1), { admitted: false, state: "pending" });
  assert.deepEqual((await listMachines(db, owner)).map((machine) => [machine.name, machine.state]), [["air", "pending"]]);
});

test("an approved machine is admitted, and two machines can be approved side by side", async () => {
  const db = freshDb();
  await admitMachine(db, owner, "air", 1);
  await admitMachine(db, owner, "studio", 2);
  assert.equal(await approveMachine(db, owner, "air", 3), true);
  assert.equal(await approveMachine(db, owner, "studio", 4), true);
  assert.deepEqual(await admitMachine(db, owner, "air", 5), { admitted: true, state: "approved" });
  assert.deepEqual(await admitMachine(db, owner, "studio", 6), { admitted: true, state: "approved" });
});

test("a logged-out machine is refused until it is allowed again", async () => {
  const db = freshDb();
  await admitMachine(db, owner, "air", 1);
  await approveMachine(db, owner, "air", 2);
  assert.equal(await logOutMachine(db, owner, "air", 3), true);
  assert.deepEqual(await admitMachine(db, owner, "air", 4), { admitted: false, state: "logged_out" });
  assert.equal(await approveMachine(db, owner, "air", 5), true);
  assert.deepEqual(await admitMachine(db, owner, "air", 6), { admitted: true, state: "approved" });
});

test("log out all shuts every machine out and names them", async () => {
  const db = freshDb();
  for (const name of ["air", "studio"]) { await admitMachine(db, owner, name, 1); await approveMachine(db, owner, name, 2); }
  assert.deepEqual((await logOutAllMachines(db, owner, 3)).sort(), ["air", "studio"]);
  assert.deepEqual((await listMachines(db, owner)).map((machine) => machine.state), ["logged_out", "logged_out"]);
});

test("the list shows machines waiting for approval first and logged-out machines last", async () => {
  const db = freshDb();
  for (const [name, at] of [["gone", 1], ["live", 2], ["new", 3]] as const) await admitMachine(db, owner, name, at);
  await approveMachine(db, owner, "live", 4);
  await approveMachine(db, owner, "gone", 4);
  await logOutMachine(db, owner, "gone", 5);
  assert.deepEqual((await listMachines(db, owner)).map((machine) => machine.name), ["new", "live", "gone"]);
});

test("a stolen login under a new name is only pending, never approved", async () => {
  const db = freshDb();
  await admitMachine(db, owner, "air", 1);
  await approveMachine(db, owner, "air", 2);
  await logOutMachine(db, owner, "air", 3);
  assert.deepEqual(await admitMachine(db, owner, "air-2", 4), { admitted: false, state: "pending" });
});

test("machines belong to one owner, and another owner cannot approve or log them out", async () => {
  const db = freshDb();
  await admitMachine(db, owner, "air", 1);
  assert.equal(await approveMachine(db, "other@example.com", "air", 2), false);
  assert.equal(await logOutMachine(db, "other@example.com", "air", 2), false);
  assert.deepEqual(await listMachines(db, "other@example.com"), []);
});

test("only a logged-out machine can be removed from the list", async () => {
  const db = freshDb();
  await admitMachine(db, owner, "air", 1);
  await approveMachine(db, owner, "air", 2);
  assert.equal(await forgetMachine(db, owner, "air"), false);
  await logOutMachine(db, owner, "air", 3);
  assert.equal(await forgetMachine(db, owner, "air"), true);
  assert.deepEqual(await listMachines(db, owner), []);
});

test("rename trims and caps the title and keeps the stable name", async () => {
  const db = freshDb();
  await admitMachine(db, owner, "air", 1);
  assert.equal(await renameMachine(db, owner, "air", "  Jordan's   Air  "), "Jordan's Air");
  assert.equal((await renameMachine(db, owner, "air", "x".repeat(200)))?.length, 80);
  assert.equal(await renameMachine(db, owner, "air", "   "), null);
  assert.equal(await renameMachine(db, owner, "nope", "x"), null);
  assert.equal((await listMachines(db, owner))[0].name, "air");
});

test("machine names are lowercase slugs and each machine has its own host key", () => {
  assert.equal(normalizeMachineName(" Air "), "air");
  assert.equal(normalizeMachineName("bad name"), null);
  assert.equal(normalizeMachineName("-x"), null);
  assert.equal(machineHostKey("A@B.com", "air"), "a@b.com#air");
});

test("the unauthenticated pairing routes are gone from the worker", () => {
  const routes = readFileSync(new URL("./routes/machines.ts", import.meta.url), "utf8");
  const index = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(routes + index, /["'`]\/machines\/(pair|connect)["'`]/);
  assert.doesNotMatch(routes + index, /registerMachinePublicRoutes|MACHINE_PUBLIC_PATHS|pair-codes/);
});

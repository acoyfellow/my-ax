import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sqliteD1 } from "./fsm/sqlite-d1";
import {
  createPairCode,
  listMachines,
  machineForCredential,
  machineHostKey,
  normalizeMachineName,
  PAIR_CODE_TTL_MS,
  redeemPairCode,
  revokeMachine,
} from "./machine-pairing";

const schema = readFileSync(new URL("../migrations/0045_machines.sql", import.meta.url), "utf8");
const owner = "Owner@Example.com";
const freshDb = () => sqliteD1(schema) as unknown as D1Database;

test("a pairing code pairs one machine once and yields a working credential", async () => {
  const db = freshDb();
  const { code } = await createPairCode(db, owner, 1_000);
  const paired = await redeemPairCode(db, code, "Mac-A", 2_000);
  assert.equal(paired.ok, true);
  if (!paired.ok) return;
  assert.equal(paired.name, "mac-a");
  assert.deepEqual(await machineForCredential(db, paired.credential), { ownerEmail: "owner@example.com", name: "mac-a" });
  const reused = await redeemPairCode(db, code, "mac-b", 3_000);
  assert.deepEqual(reused.ok ? null : reused.code, "BAD_CODE");
});

test("a code typed in lowercase without the dash still pairs", async () => {
  const db = freshDb();
  const { code } = await createPairCode(db, owner, 0);
  const paired = await redeemPairCode(db, code.replace("-", "").toLowerCase(), "mac-a", 1);
  assert.equal(paired.ok, true);
});

test("an expired code is refused", async () => {
  const db = freshDb();
  const { code } = await createPairCode(db, owner, 0);
  const late = await redeemPairCode(db, code, "mac-a", PAIR_CODE_TTL_MS + 1);
  assert.equal(late.ok ? null : late.code, "BAD_CODE");
});

test("two machines pair under one owner and are listed", async () => {
  const db = freshDb();
  for (const name of ["mac-a", "mac-b"]) {
    const { code } = await createPairCode(db, owner, 0);
    assert.equal((await redeemPairCode(db, code, name, 1)).ok, true);
  }
  assert.deepEqual((await listMachines(db, owner)).map((machine) => machine.name), ["mac-a", "mac-b"]);
});

test("a live name cannot be taken by a second pairing", async () => {
  const db = freshDb();
  const first = await createPairCode(db, owner, 0);
  await redeemPairCode(db, first.code, "mac-a", 1);
  const second = await createPairCode(db, owner, 2);
  const clash = await redeemPairCode(db, second.code, "mac-a", 3);
  assert.equal(clash.ok ? null : clash.code, "NAME_TAKEN");
});

test("revoking kills the credential and frees the name for a new pairing", async () => {
  const db = freshDb();
  const first = await createPairCode(db, owner, 0);
  const paired = await redeemPairCode(db, first.code, "mac-b", 1);
  assert.ok(paired.ok);
  if (!paired.ok) return;
  assert.equal(await revokeMachine(db, owner, "mac-b", 2), true);
  assert.equal(await machineForCredential(db, paired.credential), null);
  assert.deepEqual(await listMachines(db, owner), []);
  const again = await createPairCode(db, owner, 3);
  const repaired = await redeemPairCode(db, again.code, "mac-b", 4);
  assert.equal(repaired.ok, true);
  if (repaired.ok) assert.notEqual(repaired.credential, paired.credential);
});

test("bad names and foreign credentials are refused", async () => {
  const db = freshDb();
  assert.equal(normalizeMachineName("has space"), null);
  assert.equal(normalizeMachineName("-lead"), null);
  assert.equal(await machineForCredential(db, "not-a-credential"), null);
  assert.equal(await machineForCredential(db, "mxm_0000"), null);
});

test("each machine gets its own relay key under the owner", () => {
  assert.notEqual(machineHostKey(owner, "mac-a"), machineHostKey(owner, "mac-b"));
  assert.equal(machineHostKey(owner, "mac-a"), "owner@example.com#mac-a");
});

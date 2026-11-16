import assert from "node:assert/strict";
import test from "node:test";
import { testDb } from "../test-db";
import { acquireLease, ComputerLeaseHeldError, leaseSeconds, LEASE_MAX_SECONDS, loadLease, releaseLease, requireLeaseFree } from "./ComputerLease.store";

const key = { owner: "o@example.com", computerId: "assay-probe" };
const T = 1_800_000_000_000;

test("a free computer can be leased, and the holder can renew it", async () => {
  const db = testDb();
  const first = await acquireLease(db, key, "run-a", 60, T);
  assert.equal(first.holder, "run-a");
  const renewed = await acquireLease(db, key, "run-a", 120, T + 10_000);
  assert.equal(renewed.expiresAt, new Date(T + 10_000 + 120_000).toISOString());
});

test("a second holder is refused while the lease is live, and told who holds it", async () => {
  const db = testDb();
  await acquireLease(db, key, "run-a", 60, T);
  await assert.rejects(acquireLease(db, key, "run-b", 60, T + 1000), (error: unknown) => error instanceof ComputerLeaseHeldError && error.lease.holder === "run-a");
  await assert.rejects(requireLeaseFree(db, key, "run-b", T + 1000), ComputerLeaseHeldError);
  await assert.rejects(requireLeaseFree(db, key, undefined, T + 1000), ComputerLeaseHeldError);
  await requireLeaseFree(db, key, "run-a", T + 1000);
});

test("an expired lease frees the computer for anyone", async () => {
  const db = testDb();
  await acquireLease(db, key, "run-a", 60, T);
  await requireLeaseFree(db, key, "run-b", T + 61_000);
  const taken = await acquireLease(db, key, "run-b", 60, T + 61_000);
  assert.equal(taken.holder, "run-b");
});

test("only the holder can release, and release frees it", async () => {
  const db = testDb();
  await acquireLease(db, key, "run-a", 60, T);
  assert.equal(await releaseLease(db, key, "run-b", T + 1000), false);
  assert.equal(await releaseLease(db, key, "run-a", T + 1000), true);
  assert.equal((await loadLease(db, key))._tag, "Free");
});

test("leases are per owner and per computer", async () => {
  const db = testDb();
  await acquireLease(db, key, "run-a", 60, T);
  await requireLeaseFree(db, { ...key, owner: "x@example.com" }, "run-b", T);
  await requireLeaseFree(db, { ...key, computerId: "other" }, "run-b", T);
});

test("lease length defaults to 30 minutes and is capped at a day", () => {
  assert.equal(leaseSeconds(undefined), 1800);
  assert.equal(leaseSeconds(-5), 1800);
  assert.equal(leaseSeconds(10 ** 9), LEASE_MAX_SECONDS);
});

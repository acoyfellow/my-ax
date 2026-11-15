import assert from "node:assert/strict";
import { test } from "node:test";
import { deletePreference, putPreference, swapPreference } from "./OwnerPreference/OwnerPreference.store";
import { removePushSubscription, savePushSubscription } from "./PushSubscription/PushSubscription.store";
import { testDb } from "./test-db";

const OWNER = "o@x";

function preference(db: ReturnType<typeof testDb>) {
  return db.rows<{ value_json: string }>("SELECT value_json FROM owner_preferences WHERE owner_email = ? AND preference_key = ?", OWNER, "desk")[0]?.value_json ?? null;
}

function subscriptions(db: ReturnType<typeof testDb>) {
  return db.rows<{ owner_email: string }>("SELECT owner_email FROM push_subscriptions").map((row) => row.owner_email);
}

test("putting a preference upserts through Domain", async () => {
  const db = testDb();
  await putPreference(db, OWNER, "desk", "{\"a\":1}", "t");
  await putPreference(db, OWNER, "desk", "{\"a\":2}", "t");
  assert.deepEqual(db.writes, ["INSERT INTO owner_preferences", "INSERT INTO owner_preferences"]);
  assert.equal(preference(db), "{\"a\":2}");
});

test("deleting a missing preference writes nothing, an existing one is deleted", async () => {
  const db = testDb();
  await deletePreference(db, OWNER, "desk");
  assert.deepEqual(db.writes, []);
  await putPreference(db, OWNER, "desk", "{}", "t");
  db.writes.length = 0;
  await deletePreference(db, OWNER, "desk");
  assert.deepEqual(db.writes, ["DELETE FROM owner_preferences"]);
  assert.equal(preference(db), null);
});

test("compare-and-swap inserts when no version and updates against the expected version", async () => {
  const db = testDb();
  assert.equal(await swapPreference(db, OWNER, "desk", "{\"a\":1}", "t", null), true);
  assert.equal(await swapPreference(db, OWNER, "desk", "{\"a\":2}", "t", "{\"a\":1}"), true);
  assert.equal(await swapPreference(db, OWNER, "desk", "{\"a\":3}", "t", "{\"a\":1}"), false);
  assert.deepEqual(db.writes, ["INSERT INTO owner_preferences(owner_email,", "UPDATE owner_preferences SET", "UPDATE owner_preferences SET"]);
  assert.equal(preference(db), "{\"a\":2}");
});

test("a push subscription is saved, and only its owner can remove it", async () => {
  const db = testDb();
  await savePushSubscription(db, { id: "p1", owner: OWNER, endpoint: "https://push/1", subscriptionJson: "{}" });
  assert.deepEqual(db.writes, ["INSERT INTO push_subscriptions(id,"]);
  db.writes.length = 0;
  await removePushSubscription(db, "someone@else", "https://push/1");
  assert.deepEqual(db.writes, []);
  assert.deepEqual(subscriptions(db), [OWNER]);
  await removePushSubscription(db, OWNER, "https://push/1");
  assert.deepEqual(db.writes, ["DELETE FROM push_subscriptions"]);
  assert.deepEqual(subscriptions(db), []);
});

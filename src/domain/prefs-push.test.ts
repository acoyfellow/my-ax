import assert from "node:assert/strict";
import { test } from "node:test";
import { deletePreference, putPreference, swapPreference } from "./OwnerPreference/OwnerPreference.store";
import { removePushSubscription, savePushSubscription } from "./PushSubscription/PushSubscription.store";

function fakeDb(rowFor: (sql: string) => unknown = () => null) {
  const writes: string[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: () => ({
        run: async () => {
          writes.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
          return { meta: { changes: 1 } };
        },
        first: async <T>() => rowFor(sql) as T | null,
      }),
    }),
  };
  return { db, writes };
}

test("putting a preference upserts through Domain", async () => {
  const fresh = fakeDb();
  await putPreference(fresh.db, "o@x", "desk", "{}", "t");
  const known = fakeDb(() => ({ present: 1 }));
  await putPreference(known.db, "o@x", "desk", "{}", "t");
  assert.deepEqual([...fresh.writes, ...known.writes], ["INSERT INTO owner_preferences", "INSERT INTO owner_preferences"]);
});

test("deleting a missing preference writes nothing, an existing one is deleted", async () => {
  const fresh = fakeDb();
  await deletePreference(fresh.db, "o@x", "desk");
  const known = fakeDb(() => ({ present: 1 }));
  await deletePreference(known.db, "o@x", "desk");
  assert.deepEqual([...fresh.writes, ...known.writes], ["DELETE FROM owner_preferences"]);
});

test("compare-and-swap inserts when no version and updates against the expected version", async () => {
  const { db, writes } = fakeDb();
  assert.equal(await swapPreference(db, "o@x", "desk", "{\"a\":1}", "t", null), true);
  assert.equal(await swapPreference(db, "o@x", "desk", "{\"a\":2}", "t", "{\"a\":1}"), true);
  assert.deepEqual(writes, ["INSERT INTO owner_preferences(owner_email,", "UPDATE owner_preferences SET"]);
});

test("a push subscription is saved, and only its owner can remove it", async () => {
  const fresh = fakeDb();
  await savePushSubscription(fresh.db, { id: "p1", owner: "o@x", endpoint: "https://push/1", subscriptionJson: "{}" });
  assert.deepEqual(fresh.writes, ["INSERT INTO push_subscriptions(id,"]);
  const other = fakeDb(() => ({ owner_email: "someone@else" }));
  await removePushSubscription(other.db, "o@x", "https://push/1");
  assert.deepEqual(other.writes, []);
  const mine = fakeDb(() => ({ owner_email: "o@x" }));
  await removePushSubscription(mine.db, "o@x", "https://push/1");
  assert.deepEqual(mine.writes, ["DELETE FROM push_subscriptions"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { recordDecisionResponse, type DecisionResponseStore } from "./decision-response";

function memoryStore(): DecisionResponseStore & { events: Array<{ eventId: string; choice: string }>; open: boolean } {
  return {
    events: [],
    open: true,
    async insertEvent({ eventId, choice }) { this.events.push({ eventId, choice }); },
    async completeRun() {
      if (!this.open) return false;
      this.open = false;
      return true;
    },
    async reopenRun() {
      if (this.open) return false;
      this.open = true;
      return true;
    },
    async deleteEvent({ eventId }) {
      const index = this.events.findIndex((event) => event.eventId === eventId);
      if (index >= 0) this.events.splice(index, 1);
    },
  };
}

const input = { id: "run-decision-1", email: "owner@example.com", question: "Choose?", now: "2026-01-01T00:00:00.000Z" };

test("only one concurrent decision response completes", async () => {
  const store = memoryStore();
  const outcomes = await Promise.all([
    recordDecisionResponse(store, { ...input, choice: "A" }),
    recordDecisionResponse(store, { ...input, choice: "B" }),
  ]);

  assert.deepEqual(outcomes.sort(), [false, true]);
  assert.equal(store.events.length, 1);
});

test("repeated response is rejected without retaining another event", async () => {
  const store = memoryStore();
  assert.equal(await recordDecisionResponse(store, { ...input, choice: "A" }), true);
  assert.equal(await recordDecisionResponse(store, { ...input, choice: "A" }), false);
  assert.deepEqual(store.events.map((event) => event.choice), ["A"]);
});

test("failed session resume reopens the decision and removes its answer event", async () => {
  const store = memoryStore();
  await assert.rejects(
    recordDecisionResponse(store, { ...input, choice: "A" }, async () => { throw new Error("session unavailable"); }),
    /session unavailable/,
  );
  assert.equal(store.open, true);
  assert.deepEqual(store.events, []);
  assert.equal(await recordDecisionResponse(store, { ...input, choice: "B" }), true);
});

test("a failed resume deletes the answer event exactly once (no double delete)", async () => {
  const store = memoryStore();
  let deleteCalls = 0;
  const origDelete = store.deleteEvent.bind(store);
  store.deleteEvent = async (e) => { deleteCalls++; return origDelete(e); };
  await assert.rejects(
    recordDecisionResponse(store, { ...input, choice: "A" }, async () => { throw new Error("session unavailable"); }),
    /session unavailable/,
  );
  assert.equal(deleteCalls, 1, "cleanup must delete the event exactly once");
  assert.deepEqual(store.events, []);
  assert.equal(store.open, true);
});

test("a failed resume whose reopen ALSO fails keeps the answer event (never orphans a completed run)", async () => {
  const store = memoryStore();
  store.reopenRun = async () => { throw new Error("reopen unavailable"); };
  let deleteCalls = 0;
  const origDelete = store.deleteEvent.bind(store);
  store.deleteEvent = async (e) => { deleteCalls++; return origDelete(e); };
  await assert.rejects(
    recordDecisionResponse(store, { ...input, choice: "A" }, async () => { throw new Error("resume boom"); }),
    /Failed to reopen decision/,
  );
  assert.equal(deleteCalls, 0, "must not delete the answer when the rollback is unconfirmed");
  assert.equal(store.events.length, 1);
});

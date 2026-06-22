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

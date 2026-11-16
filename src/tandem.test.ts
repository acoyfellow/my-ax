import assert from "node:assert/strict";
import test from "node:test";
import { fallbackRoute, parseClefRoute, planFor, routeMessage, TANDEM_ROUTER_MODEL } from "./tandem";
import { CONVO_STYLE_SPECS, PICKER_STYLES } from "./convo-style";

test("the picker offers only Standard and Tandem", () => {
  assert.deepEqual([...PICKER_STYLES], ["standard", "tandem"]);
  assert.equal(CONVO_STYLE_SPECS.tandem.midTurn, "tandem");
});

test("Clef's choice is used when it is one of the four kinds", async () => {
  const ai = { run: async (model: string) => { assert.equal(model, TANDEM_ROUTER_MODEL); return { answers: { kind: { type: "choice", choice: "correction", confidence: 0.83 } } }; } };
  const route = await routeMessage(ai, "no, use the staging bucket");
  assert.equal(route.kind, "correction");
  assert.equal(route.source, "clef");
});

test("a Clef failure or a bad answer falls back to the word rules, never to a stop by accident", async () => {
  assert.equal((await routeMessage({ run: async () => { throw new Error("down"); } }, "where are you at?")).kind, "question");
  assert.equal((await routeMessage({ run: async () => ({ answers: { kind: { choice: "dance" } } }) }, "add a test too")).kind, "instruction");
  assert.equal(parseClefRoute(null), null);
  assert.equal(fallbackRoute("stop"), "stop");
  assert.equal(fallbackRoute("actually use staging"), "correction");
  assert.equal(fallbackRoute("also bump the version"), "instruction");
});

test("each kind maps to one plan: answer on the side, steer, or stop at a safe point", () => {
  assert.deepEqual(planFor("question", "eta?"), { action: "answer" });
  assert.deepEqual(planFor("instruction", "add tests"), { action: "steer", text: "add tests" });
  assert.match((planFor("correction", "use staging") as { text: string }).text, /^Correction from the owner/);
  assert.deepEqual(planFor("stop", "stop"), { action: "stop-at-safe-point", then: null });
});

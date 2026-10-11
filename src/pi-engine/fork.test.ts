import assert from "node:assert/strict";
import { test } from "node:test";
import { forkEntriesUpTo, parseForkPoint } from "./fork";

test("a screen message id from the new engine resolves to its pi entry", () => {
  assert.equal(parseForkPoint("pi-23-0"), 23);
  assert.equal(parseForkPoint("pi-7-2"), 7);
  assert.equal(parseForkPoint("08da1973-cc22-4c53-a576-a0e10bb8d247"), null);
});

test("forking copies the conversation up to and including the chosen entry, in order", () => {
  const entries = [
    { id: 4, kind: "pi.assistant", model: [{ role: "assistant", content: "first reply" }] },
    { id: 1, kind: "pi.user", model: [{ role: "user", content: "hi" }] },
    { id: 2, kind: "pi.run-start" },
    { id: 6, kind: "pi.user", model: [{ role: "user", content: "later" }] },
  ];
  const copied = forkEntriesUpTo(entries, 4);
  assert.deepEqual(copied.map((entry) => entry.kind), ["pi.user", "pi.assistant"]);
  assert.equal(JSON.stringify(copied).includes("later"), false);
});

test("an unknown fork point is rejected", () => {
  assert.throws(() => forkEntriesUpTo([{ id: 1, kind: "pi.user" }], 9), /Fork point was not found/);
});

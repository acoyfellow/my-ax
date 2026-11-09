import assert from "node:assert/strict";
import { test } from "node:test";
import { amberEnabled, setAmber } from "./amber";

test("amber is off unless explicitly enabled", () => {
  assert.equal(amberEnabled({}), false);
  assert.equal(amberEnabled({ AMBER_ENABLED: "1" }), true);
});

test("setting amber writes 1 and clearing writes 0 for the owned session only", async () => {
  const writes: unknown[][] = [];
  const db = {
    prepare: () => ({
      bind: (...binds: unknown[]) => ({
        run: async () => { writes.push(binds); return { meta: { changes: 1 } }; },
      }),
    }),
  };
  assert.equal(await setAmber(db as never, "s1", "o@x", true), true);
  assert.equal(await setAmber(db as never, "s1", "o@x", false), true);
  assert.deepEqual(writes, [[1, "s1", "o@x"], [0, "s1", "o@x"]]);
});

test("setting amber on a session that is not owned changes nothing", async () => {
  const db = { prepare: () => ({ bind: () => ({ run: async () => ({ meta: { changes: 0 } }) }) }) };
  assert.equal(await setAmber(db as never, "s1", "other@x", true), false);
});

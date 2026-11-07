import assert from "node:assert/strict";
import { test } from "node:test";
import { audit, MACHINES } from "./fsm-audit.mjs";

const read = (text) => () => text;

test("all eleven machines are audited", () => {
  assert.equal(MACHINES.length, 11);
});

test("a raw sessions status write outside src/fsm is reported", () => {
  const violations = audit(["/repo/src/agent.ts"], read(`await db.prepare("UPDATE sessions SET status = 'active' WHERE id = ?")`));
  assert.equal(violations.length, 1);
  assert.equal(violations[0].machine, "sessions");
});

test("a write through the transition function is not reported", () => {
  assert.equal(audit(["/repo/src/agent.ts"], read(`await applySessionEvent(db, ref, "turn_started")`)).length, 0);
});

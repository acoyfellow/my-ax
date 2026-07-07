import assert from "node:assert/strict";
import test from "node:test";
import {
  activeTurnIsRestorable,
  pendingFirstBelongsHere,
  ACTIVE_TURN_MAX_AGE_MS,
} from "./session-latch";

test("active-turn latch restores only for the mounted session when fresh", () => {
  const now = 1_000_000;
  assert.equal(
    activeTurnIsRestorable({ id: "R1", clientMsgId: "u1", at: now, sessionId: "S1" }, "S1", now),
    true,
  );
});

test("active-turn latch bound to a different session is rejected", () => {
  const now = 1_000_000;
  assert.equal(
    activeTurnIsRestorable({ id: "R1", clientMsgId: "u1", at: now, sessionId: "S1" }, "S2", now),
    false,
  );
});

test("legacy active-turn latch without a sessionId is treated as stale", () => {
  const now = 1_000_000;
  assert.equal(
    activeTurnIsRestorable({ id: "R1", clientMsgId: "u1", at: now } as any, "S1", now),
    false,
  );
});

test("active-turn latch older than the max age is rejected", () => {
  const now = 1_000_000_000;
  assert.equal(
    activeTurnIsRestorable(
      { id: "R1", clientMsgId: "u1", at: now - ACTIVE_TURN_MAX_AGE_MS - 1, sessionId: "S1" },
      "S1",
      now,
    ),
    false,
  );
});

test("null/empty latch is not restorable", () => {
  assert.equal(activeTurnIsRestorable(null, "S1"), false);
  assert.equal(activeTurnIsRestorable({} as any, "S1"), false);
});

test("pending-first payload adopted only by its bound session", () => {
  assert.equal(pendingFirstBelongsHere("S1", "S1"), true);
  assert.equal(pendingFirstBelongsHere("S1", "S2"), false);
});

test("pending-first payload with no binding is backward-compatible", () => {
  assert.equal(pendingFirstBelongsHere(null, "S1"), true);
  assert.equal(pendingFirstBelongsHere(undefined, "S1"), true);
  assert.equal(pendingFirstBelongsHere("", "S1"), true);
});

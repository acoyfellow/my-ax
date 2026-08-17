import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionTurnState, sessionRowToTurnStatus, sessionTurnLocksComposer } from "./session-turn";

test("sessionRowToTurnStatus maps running to thinking and everything else to idle", () => {
  assert.equal(sessionRowToTurnStatus("running"), "thinking");
  assert.equal(sessionRowToTurnStatus("active"), "idle");
  assert.equal(sessionRowToTurnStatus("error"), "idle");
  assert.equal(sessionRowToTurnStatus(undefined), "idle");
});

test("buildSessionTurnState is typed and includes requestId", () => {
  const state = buildSessionTurnState({
    sessionId: "sess-1",
    sessionStatus: "running",
    requestId: "req-9",
    updatedAt: "2026-08-16 00:00:00",
  });
  assert.deepEqual(state, {
    sessionId: "sess-1",
    status: "thinking",
    requestId: "req-9",
    sessionStatus: "running",
    updatedAt: "2026-08-16 00:00:00",
  });
});

test("sessionTurnLocksComposer follows server session status, not a local FSM", () => {
  assert.equal(sessionTurnLocksComposer(buildSessionTurnState({ sessionId: "s", sessionStatus: "running" })), true);
  assert.equal(sessionTurnLocksComposer(buildSessionTurnState({ sessionId: "s", sessionStatus: "active" })), false);
});

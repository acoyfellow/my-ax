import assert from "node:assert/strict";
import test from "node:test";
import { requireOwnedVoiceSession, resolveOwnedVoiceTarget } from "./voice-session-ownership";

const identity = { email: "Owner@Example.com", sub: "owner" };

function database(row: { id: string } | null) {
  const calls: unknown[][] = [];
  return {
    calls,
    prepare(query: string) {
      assert.match(query, /owner_email = \?/);
      return {
        bind(...values: unknown[]) {
          calls.push(values);
          return { first: async <T>() => row as T | null };
        },
      };
    },
  };
}

test("voice session ownership accepts the authenticated owner's session", async () => {
  const db = database({ id: "session-1" });
  await requireOwnedVoiceSession(db, identity, "session-1");
  assert.equal(await resolveOwnedVoiceTarget(db, identity, "session-1"), "owner@example.com:session-1");
  assert.deepEqual(db.calls, [["session-1", "owner@example.com"], ["session-1", "owner@example.com"]]);
});

test("voice session ownership fails closed for missing or foreign sessions", async () => {
  const db = database(null);
  await assert.rejects(
    requireOwnedVoiceSession(db, identity, "foreign-session"),
    /Session not found or not owned/,
  );
  assert.deepEqual(db.calls, [["foreign-session", "owner@example.com"]]);
});

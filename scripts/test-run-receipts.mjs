import assert from "node:assert/strict";
import { appendOwnedRunEvent, RunReceiptNotFoundError } from "../src/run-receipts.ts";

function mockContext({ owned = true } = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      get: () => ({ email: "owner@example.com" }),
      env: {
        DB: {
          prepare(sql) {
            return {
              bind(...values) {
                calls.push({ sql, values });
                return {
                  first: async () => owned ? { id: "run-1" } : null,
                  run: async () => ({ success: true }),
                };
              },
            };
          },
        },
      },
    },
  };
}

const originalUuid = globalThis.crypto.randomUUID;
globalThis.crypto.randomUUID = () => "00000000-0000-4000-8000-000000000001";
try {
  const { calls, ctx } = mockContext();
  const result = await appendOwnedRunEvent(ctx, "run-1", {
    actor: { id: "machinectl:laptop", kind: "machinectl", mode: "live" },
    type: "machinectl.observation.captured",
    ts: "2026-06-04T00:00:00.000Z",
    data: { observation: "connected-laptop-session", session: { harness: "pi", id: "session-7" }, explicit: true, noTranscript: true, noAttach: true },
  });

  assert.deepEqual(result, {
    runId: "run-1",
    eventId: "evt-machinectl.observation.captured-00000000-0000-4000-8000-000000000001",
    type: "machinectl.observation.captured",
  });
  assert.match(calls[0].sql, /runs WHERE id = \? AND owner_email = \?/);
  assert.deepEqual(calls[0].values, ["run-1", "owner@example.com"]);
  assert.match(calls[1].sql, /INSERT INTO run_events/);
  assert.equal(calls[1].values[2], "owner@example.com");
  assert.deepEqual(JSON.parse(calls[1].values[6]), { observation: "connected-laptop-session", session: { harness: "pi", id: "session-7" }, explicit: true, noTranscript: true, noAttach: true });
  assert.match(calls[2].sql, /UPDATE runs SET status/);
  assert.deepEqual(calls[2].values, ["run-1", "owner@example.com"]);

  await assert.rejects(() => appendOwnedRunEvent(mockContext({ owned: false }).ctx, "other-run", {
    actor: { id: "machinectl:laptop", kind: "machinectl", mode: "live" },
    type: "machinectl.observation.captured",
  }), RunReceiptNotFoundError);

  console.log("run receipt owner-scoped event append: ok");
} finally {
  globalThis.crypto.randomUUID = originalUuid;
}

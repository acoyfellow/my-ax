import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { ModelOutputError, parseModelOutput } from "./model-output";

test("repairs malformed model output once", async () => {
  const calls: string[] = [];
  const result = await Effect.runPromise(parseModelOutput<{ ok: true }>("{\"ok\":true} trailing", (raw, error) => {
    calls.push(`${raw}|${error}`);
    return Promise.resolve("{\"ok\":true}");
  }));
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
});

test("retains raw output when repair fails", async () => {
  const raw = "not json";
  await assert.rejects(
    () => Effect.runPromise(parseModelOutput(raw, () => Promise.resolve("still not json"))),
    (error: unknown) => error instanceof ModelOutputError && error.raw === raw,
  );
});

test("does not repeat repair after a repaired response remains invalid", async () => {
  let calls = 0;
  await assert.rejects(() => Effect.runPromise(parseModelOutput("bad", () => {
    calls += 1;
    return Promise.resolve("bad again");
  })));
  assert.equal(calls, 1);
});

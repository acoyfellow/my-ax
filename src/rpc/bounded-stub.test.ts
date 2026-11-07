import assert from "node:assert/strict";
import test from "node:test";
import { resolveStub, StubUnavailableError } from "./bounded-stub";

const quiet = () => { const log = console.log; console.log = () => undefined; return () => { console.log = log; }; };

test("a stub that never initializes fails fast with a 503 instead of hanging the request", async () => {
  const restore = quiet();
  try {
    const started = Date.now();
    await assert.rejects(resolveStub("UserAgent.init", () => new Promise(() => undefined), 20), (error: unknown) => {
      assert.ok(error instanceof StubUnavailableError);
      assert.equal(error.status, 503);
      assert.equal(error.reason, "timeout");
      return true;
    });
    assert.ok(Date.now() - started < 1_000);
  } finally {
    restore();
  }
});

test("a healthy stub resolves to the stub", async () => {
  const restore = quiet();
  try {
    const stub = { name: "s" };
    assert.equal(await resolveStub("UserAgent.init", async () => stub), stub);
  } finally {
    restore();
  }
});

test("an initialization error is surfaced as unavailable with the cause in the message", async () => {
  const restore = quiet();
  try {
    await assert.rejects(resolveStub("UserAgent.init", async () => { throw new Error("reset"); }), /UserAgent.init failed: reset/);
  } finally {
    restore();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { command, idempotentCommand, query, RpcTimeoutError, startJob } from "./contract";

const quiet = () => { const log = console.log; console.log = () => undefined; return () => { console.log = log; }; };

const never = <T>() => new Promise<T>(() => undefined);

test("a query that hangs once is asked again and returns the second answer", async () => {
  const restore = quiet();
  try {
    let calls = 0;
    const value = await query("Session.read", () => (++calls === 1 ? never<string>() : Promise.resolve("fresh")), 20);
    assert.equal(value, "fresh");
    assert.equal(calls, 2);
  } finally {
    restore();
  }
});

test("a plain command is sent once and a timeout says it may still finish", async () => {
  const restore = quiet();
  try {
    let calls = 0;
    await assert.rejects(command("Session.setModel", () => { calls += 1; return never(); }, 20), (error: unknown) => {
      assert.ok(error instanceof RpcTimeoutError);
      assert.equal(error.kind, "command");
      assert.match(error.message, /may still finish/);
      return true;
    });
    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

test("an idempotent command resends the same operation id and reports it on timeout", async () => {
  const restore = quiet();
  try {
    const seen: string[] = [];
    await assert.rejects(idempotentCommand("Machine.invoke", "op-abc-12345", (opId) => { seen.push(opId); return never(); }, 20), (error: unknown) => {
      assert.ok(error instanceof RpcTimeoutError);
      assert.equal(error.opId, "op-abc-12345");
      return true;
    });
    assert.ok(seen.length >= 1);
    assert.ok(seen.every((opId) => opId === "op-abc-12345"));
  } finally {
    restore();
  }
});

test("starting a job is never resent and its errors pass through unchanged", async () => {
  const restore = quiet();
  try {
    let calls = 0;
    const boom = new Error("busy");
    await assert.rejects(startJob("Job.start", "job-1-abcdef", () => { calls += 1; return Promise.reject(boom); }, 1_000), (error: unknown) => error === boom);
    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCoordinatorJob, wrapCoordinatorCode } from "./coordinator-code";
import type { JobRow } from "./jobs";

const METHODS = ["listSessions", "getSession"];

test("bare method names are bound from codemode", async () => {
  const wrapped = wrapCoordinatorCode("async () => listSessions({ limit: 1 })", METHODS);
  const codemode = { listSessions: async (args: { limit: number }) => ({ called: args.limit }), getSession: async () => null };
  const run = new Function("codemode", `return (${wrapped})();`) as (api: typeof codemode) => Promise<unknown>;
  assert.deepEqual(await run(codemode), { called: 1 });
});

test("code that already uses codemode.<method> is left alone", () => {
  const code = "async () => codemode.listSessions({})";
  assert.equal(wrapCoordinatorCode(code, METHODS), code);
});

test("a bare expression still evaluates", async () => {
  const run = new Function("codemode", `return (${wrapCoordinatorCode("42", METHODS)})();`) as (api: object) => Promise<unknown>;
  assert.equal(await run({ listSessions: () => null, getSession: () => null }), 42);
});

test("listed jobs carry a prompt length instead of the prompt body", () => {
  const job = { id: "j1", name: "n", prompt: "secret long prompt", cadence_secs: 60 } as unknown as JobRow;
  const summary = summarizeCoordinatorJob(job);
  assert.equal("prompt" in summary, false);
  assert.equal(summary.promptChars, 18);
  assert.equal(summary.id, "j1");
});

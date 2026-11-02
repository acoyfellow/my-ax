import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizeCode } from "@cloudflare/codemode";
import { summarizeCoordinatorJob, wrapCoordinatorCode } from "./coordinator-code";
import type { JobRow } from "./jobs";

const METHODS = ["listSessions", "getSession"];
const codemode = { listSessions: async () => ["s1"], getSession: async () => "g" };

async function run(code: string): Promise<unknown> {
  const program = normalizeCode(wrapCoordinatorCode(code, METHODS));
  return (new Function("codemode", `return (${program})();`) as (api: typeof codemode) => Promise<unknown>)(codemode);
}

test("bare method names and codemode.<method> both reach the same method", async () => {
  assert.deepEqual(await run("async () => listSessions({})"), ["s1"]);
  assert.deepEqual(await run("async () => codemode.listSessions({})"), ["s1"]);
});

test("statement bodies, fenced code and function declarations keep working", async () => {
  assert.equal(await run("const r = await listSessions({});\nr.length"), 1);
  assert.equal(await run("const r = await codemode.listSessions({});\nr.length"), 1);
  assert.deepEqual(await run("```js\nasync () => listSessions({})\n```"), ["s1"]);
  assert.deepEqual(await run("async function main() { return getSession({}); }"), "g");
});

test("a comment that mentions codemode. does not disable bare names", async () => {
  assert.deepEqual(await run("// uses codemode.listSessions\nasync () => listSessions({})"), ["s1"]);
});

test("the caller's own variables shadow the bound method names", async () => {
  assert.equal(await run("async () => { const listSessions = 5; return listSessions; }"), 5);
  assert.equal(await run("const listSessions = 7;\nlistSessions"), 7);
});

test("my_ax_code runs caller code through the wrapper", () => {
  const source = readFileSync(new URL("./routes/mcp.ts", import.meta.url), "utf8");
  assert.match(source, /executor\.execute\(wrapCoordinatorCode\(code, CODE_METHOD_NAMES\)/);
});

test("listed jobs carry a prompt length instead of the prompt body", () => {
  const job = { id: "j1", name: "n", prompt: "secret long prompt", cadence_secs: 60 } as unknown as JobRow;
  const summary = summarizeCoordinatorJob(job);
  assert.equal("prompt" in summary, false);
  assert.equal(summary.promptChars, 18);
  assert.equal(summary.id, "j1");
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const agent = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");

test("RPC inject starts Think before submit so scheduled jobs do not Illegal invocation", () => {
  const start = agent.indexOf("async injectUserMessage");
  const end = agent.indexOf("async sessionTurnState");
  assert.ok(start >= 0 && end > start);
  const slice = agent.slice(start, end);
  assert.match(slice, /await this\.onStart\(\)/);
  assert.match(slice, /this\.runTurn/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./work-tools.ts", import.meta.url), "utf8");
const agent = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");

test("work_code sandboxOnly turns withhold machine and keep factory page verbs", () => {
  assert.match(source, /export const SANDBOX_ONLY_WORK_CAPABILITIES = WORKSPACE_METHODS\.map/);
  assert.match(source, /sandboxOnly \? \{ catalog: \[\]/);
  assert.match(source, /FACTORY_PAGE_METHODS/);
  assert.match(source, /sandboxOnly \? "globalThis\.machine=undefined;"/);
  assert.doesNotMatch(source, /List or filter codemode tools across My AX Workspace, My Machine/);
});

test("open_issue_session is a Worker tool for factory fan-out", () => {
  const tools = readFileSync(new URL("./tools.ts", import.meta.url), "utf8");
  assert.match(tools, /name: "open_issue_session"/);
  assert.match(tools, /issueSessionTitle/);
  assert.match(tools, /if \(sandboxOnly && definition\.name === "cmux_observe"\) continue/);
});

test("job inject and recurring alarm both set sandboxOnly", () => {
  assert.match(agent, /sandboxOnly: Boolean\(body\.clientMsgId\?\.startsWith\("job:"\)\)/);
  assert.match(agent, /sandboxOnly: true/);
  assert.match(agent, /callPage: \(verb, args, opts\) => this\.callPage/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./work-tools.ts", import.meta.url), "utf8");
const agent = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");

test("work_code sandboxOnly turns withhold machine and page", () => {
  assert.match(source, /export const SANDBOX_ONLY_WORK_CAPABILITIES = WORKSPACE_METHODS\.map/);
  assert.match(source, /sandboxOnly \? \{ catalog: \[\]/);
  assert.match(source, /callPage: sandboxOnly \? undefined : ctx\.callPage/);
  assert.match(source, /allowedWorkCapabilities: sandboxOnly \? SANDBOX_ONLY_WORK_CAPABILITIES/);
  assert.match(source, /sandboxOnly \? "globalThis\.machine=undefined;"/);
});

test("job inject and recurring alarm both set sandboxOnly", () => {
  assert.match(agent, /sandboxOnly: Boolean\(body\.clientMsgId\?\.startsWith\("job:"\)\)/);
  assert.match(agent, /sandboxOnly: true/);
  assert.match(agent, /callPage: sandboxOnly \? undefined/);
});

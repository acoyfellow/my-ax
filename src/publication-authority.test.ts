import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const agent = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");
const workTools = readFileSync(new URL("./work-tools.ts", import.meta.url), "utf8");

test("work_code may file a GitHub issue when the owner asked this turn", () => {
  assert.match(agent, /work_code may run owner-authenticated gh commands the owner just asked for/);
  assert.match(agent, /gh issue create/);
  assert.doesNotMatch(agent, /No publication authority is available inside work_code/);
});

test("work_code still withholds raw network and credentials", () => {
  assert.match(workTools, /No raw network, credentials, or environment is exposed/);
  assert.match(workTools, /Owner-authenticated gh in My AX Workspace may file or comment only when the owner asked in this turn/);
  assert.doesNotMatch(workTools, /publication authority is exposed/);
});

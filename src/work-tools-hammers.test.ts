import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./work-tools.ts", import.meta.url), "utf8");
const agent = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");

test("work_code exposes owner-approved saved hammers as a small hammer namespace", () => {
  assert.match(source, /hammer\.list\(\)/);
  assert.match(source, /hammer\.run\(\{id\|name,input\}\)/);
  assert.match(source, /ctx\.listSavedHammers/);
  assert.match(source, /ctx\.runSavedHammer/);
  assert.match(source, /namespace\("hammer", Object\.keys\(hammerFns\)\)/);
  assert.match(source, /method: `hammer\.run:\$\{hammer\.name\}`/);
  assert.match(agent, /listSavedHammers: async \(\) =>/);
  assert.match(agent, /runSavedHammer: async \(input\) =>/);
});

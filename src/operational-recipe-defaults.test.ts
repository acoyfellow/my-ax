import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const agent = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");
const workTools = readFileSync(new URL("./work-tools.ts", import.meta.url), "utf8");

test("system prompt treats reusable tools as an operational Pantry and searches by default for recurring work", () => {
  assert.match(agent, /owner's operational Pantry/);
  assert.match(agent, /multi-step, recurring, stateful, or easy-to-half-complete work, search codemode before inventing an ad-hoc procedure/);
  assert.match(agent, /run it by default when it safely satisfies the request/);
  assert.match(agent, /Do not force a weak match/);
});

test("system prompt requires postcondition evidence rather than equating visible intent with completion", () => {
  assert.match(agent, /distinguish intent, attempted delivery, and verified completion/);
  assert.match(agent, /Never claim success merely because text is visible/);
  assert.match(agent, /CMUX prompt is submitted only when the live agent begins working or produces new output/);
  assert.match(agent, /typed-but-unsubmitted input/);
});

test("work_code description surfaces recipe-first behavior at tool-selection time", () => {
  assert.match(workTools, /search codemode first and run a strong reusable-tool match by default/);
  assert.match(workTools, /do not force weak matches for trivial work/);
});

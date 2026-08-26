import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

function namesFrom(source: string, marker: string): string[] {
  const start = source.indexOf(marker);
  assert.ok(start > -1, `could not find ${marker}`);
  const end = source.indexOf("] as const;", start);
  const block = source.slice(start, end > -1 ? end : undefined);
  return [...block.matchAll(/name:\s*"([a-zA-Z]+)"/g)].map((m) => m[1]).sort();
}

test("the agent-facing page catalog matches the browser page verbs", async () => {
  const { PAGE_VERBS } = await import("./ui/page-registry");
  const browser = PAGE_VERBS.map((v) => v.name).sort();
  const agent = namesFrom(readFileSync(new URL("./work-tools.ts", import.meta.url), "utf8"), "const PAGE_WORK_METHODS");
  const missingForAgent = browser.filter((n) => !agent.includes(n));
  const phantom = agent.filter((n) => !browser.includes(n));
  assert.deepEqual(missingForAgent, [], `verbs the browser has but the agent cannot call: ${missingForAgent.join(", ")}`);
  assert.deepEqual(phantom, [], `verbs the agent is told about but the browser cannot run: ${phantom.join(", ")}`);
});

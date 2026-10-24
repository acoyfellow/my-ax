import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const FACET_AGENT_SOURCES = ["./agent.ts", "./pi-engine/pi-chat-agent.ts"];

test("facet agents read schedules with the async listSchedules, which works in routed schedule storage", () => {
  for (const path of FACET_AGENT_SOURCES) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\bgetSchedules\(/, `${path} must not call the synchronous getSchedules()`);
    assert.match(source, /await this\.listSchedules\(\)/, `${path} arms its turn watchdog through listSchedules()`);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const AGENT_SOURCES = ["./agent.ts", "./pi-engine/pi-chat-agent.ts"];

function scheduledCallbackBody(source: string): string {
  const start = source.indexOf("async snapshotWorkspaceAfterTurn()");
  assert.ok(start >= 0, "snapshotWorkspaceAfterTurn exists");
  const end = source.indexOf("\n  }\n", start);
  return source.slice(start, end);
}

test("the scheduled turn snapshot detaches its slow disk and backup work so the job queue is not starved", () => {
  for (const path of AGENT_SOURCES) {
    const body = scheduledCallbackBody(readFileSync(new URL(path, import.meta.url), "utf8"));
    assert.match(body, /this\.ctx\.waitUntil\(this\.keepAliveWhile\(\(\) => this\.publishTurnSnapshot\(\)\)\)/, path);
    assert.doesNotMatch(body, /snapshotWorkspace\(|saveWorkspaceDisk\(/, `${path} must not await snapshots inside the scheduled job`);
  }
});

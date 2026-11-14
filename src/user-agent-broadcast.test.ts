import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./user-agent.ts", import.meta.url), "utf8");

test("a desk broadcast reaches each session's pi chat sockets", () => {
  assert.match(source, /openPiChat\(this\.env, owner, sessionId\)\)\.broadcastFrame\(frame\)/);
  assert.match(readFileSync(new URL("./pi-engine/pi-chat-agent.ts", import.meta.url), "utf8"), /async broadcastFrame\(frame: string\)/);
});

test("a desk broadcast never touches retired think facets", () => {
  assert.doesNotMatch(source, /getSubAgentByName|_cf_broadcastToSubAgent|MyAgent/);
});

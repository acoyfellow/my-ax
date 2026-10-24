import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SESSION_AGENT_CLASS, sessionSocketPath } from "./user-agent";

test("a desk broadcast addresses each session's sockets under the owner root", () => {
  const root = [{ className: "UserAgent", name: "owner@example.com" }];
  assert.deepEqual(sessionSocketPath(root, "s1"), [
    { className: "UserAgent", name: "owner@example.com" },
    { className: "MyAgent", name: "s1" },
  ]);
});

test("the session class name is the MyAgent export the root routes to", () => {
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(wrangler, new RegExp(`"class_name": "${SESSION_AGENT_CLASS}"`));
  const source = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");
  assert.match(source, new RegExp(`export class ${SESSION_AGENT_CLASS}\\b`));
});

test("a desk broadcast never wakes session facets", () => {
  const source = readFileSync(new URL("./user-agent.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /getSubAgentByName/);
  assert.match(source, /_cf_broadcastToSubAgent/);
});

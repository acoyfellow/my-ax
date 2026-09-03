import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./routes/mcp.ts", import.meta.url)), "utf8");
const toolsSource = readFileSync(fileURLToPath(new URL("./tools.ts", import.meta.url)), "utf8");

function methodList(text: string): string[] {
  const match = text.match(/const METHODS = \[([\s\S]*?)\] as const/);
  assert.ok(match, "METHODS array is present");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

test("coordinator catalog includes the control-plane methods", () => {
  const methods = methodList(source);
  for (const method of ["session_state", "abort", "heal", "workspace_write", "artifact_list", "artifact_get", "desk_get", "desk_upsert", "desk_clear"]) {
    assert.ok(methods.includes(method), `missing ${method}`);
  }
});

test("control-plane methods are exposed on my_ax_code", () => {
  for (const name of ["workspaceWrite", "sessionState", "abort", "heal", "artifactList", "artifactGet", "deskGet", "deskUpsert", "deskClear"]) {
    assert.match(source, new RegExp(`${name}:`));
  }
});

test("chat agent can read artifact source", () => {
  assert.match(toolsSource, /name: "get_artifact"/);
});

test("MCP exposes ask_owner as a durable decision cockpit", () => {
  assert.match(source, /name: "ask_owner"/);
  assert.match(source, /createDecision/);
  assert.match(source, /decision: \{ id: decision.id, options \}/);
});

test("MCP exposes desk_get, desk_upsert, and desk_clear as first-class tools", () => {
  assert.match(source, /name: "desk_get"/);
  assert.match(source, /name: "desk_upsert"/);
  assert.match(source, /name: "desk_clear"/);
});

test("MCP desk_upsert supports descriptive status and conversation replies", () => {
  const deskTool = source.slice(source.indexOf('name: "desk_upsert"'), source.indexOf('name: "desk_get"'));
  assert.match(deskTool, /actionHref/);
  assert.match(deskTool, /agent/);
  assert.match(deskTool, /originSessionId/);
  assert.match(deskTool, /reply:/);
  assert.doesNotMatch(deskTool, /enum: \["pending", "approved", "rejected"\]/);
});

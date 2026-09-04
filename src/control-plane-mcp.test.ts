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
  for (const method of ["session_state", "abort", "heal", "workspace_write", "artifact_list", "artifact_get", "desk_get", "desk_upsert", "desk_remove", "desk_clear"]) {
    assert.ok(methods.includes(method), `missing ${method}`);
  }
});

test("control-plane methods are exposed on my_ax_code", () => {
  for (const name of ["workspaceWrite", "sessionState", "abort", "heal", "artifactList", "artifactGet", "deskGet", "deskUpsert", "deskRemove", "deskClear"]) {
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

test("MCP exposes and dispatches desk_remove as a first-class owner-scoped tool", () => {
  assert.match(source, /name: "desk_remove"/);
  assert.match(source, /method === "desk_remove"\) \{\n    return ownerDeskRemove/);
  assert.match(source, /name === "desk_remove"\) \{\n        return c\.json\(rpc\(req\.id, text\(await ownerDeskRemove/);
});

test("the chat tool exposes and registers desk_remove", () => {
  assert.match(toolsSource, /export const DESK_REMOVE_TOOL: ToolDef = \{[\s\S]*?name: "desk_remove"[\s\S]*?ownerDeskRemove/);
  assert.match(toolsSource, /DESK_REMOVE_TOOL,/);
});

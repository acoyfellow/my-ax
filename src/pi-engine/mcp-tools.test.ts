import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { catalogToolEntries, MCP_EXTENSION_NAME, MCP_TOOL_NAME_LIMIT, mcpInputSchema, mcpServerName, mcpToolName, mcpToolsExtension } from "./mcp-tools";

const jira = { name: "jira__search_issues", serverId: "srv-abc", toolName: "search_issues", description: "Search Jira issues", inputSchema: { type: "object", properties: { jql: { type: "string" } }, required: ["jql"] } };

test("tools are named mcp__<server>__<tool> like the Pi CLI", () => {
  assert.equal(mcpServerName(jira), "jira");
  assert.equal(mcpToolName("dev-radius", "get.item"), "mcp__dev_radius__get_item");
});

test("long names are cut to the model limit with a stable hash", () => {
  const name = mcpToolName("a".repeat(40), "b".repeat(40));
  assert.equal(name.length, MCP_TOOL_NAME_LIMIT);
  assert.equal(name, mcpToolName("a".repeat(40), "b".repeat(40)));
  assert.notEqual(name, mcpToolName("a".repeat(40), `${"b".repeat(39)}c`));
});

test("a server without a usable object schema gets an empty object schema", () => {
  assert.deepEqual(mcpInputSchema(undefined), { type: "object", properties: {} });
  assert.deepEqual(mcpInputSchema({ type: "string" }), { type: "object", properties: {} });
  assert.equal(mcpInputSchema(jira.inputSchema), jira.inputSchema);
});

test("duplicate names keep the first tool", () => {
  const entries = catalogToolEntries([jira, { ...jira, description: "second" }]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.tool.description, "Search Jira issues");
});

test("each connector tool is a deferred tool that calls its own server", async () => {
  const calls: unknown[] = [];
  const extension = mcpToolsExtension([jira], () => ({ list: async () => [jira], call: async (serverId, toolName, args) => { calls.push([serverId, toolName, args]); return "{\"issues\":[]}"; } }));
  assert.equal(extension.name, MCP_EXTENSION_NAME);
  const tool = extension.tools?.[0] as unknown as { name: string; deferred?: true; parameters: unknown; execute: (args: unknown, api: unknown, context: unknown) => Promise<{ output: Array<{ text: string }> }> };
  assert.equal(tool.name, "mcp__jira__search_issues");
  assert.equal(tool.deferred, true);
  assert.deepEqual(tool.parameters, jira.inputSchema);
  const result = await tool.execute({ jql: "project = X" }, {}, BACKGROUND_CONTEXT);
  assert.deepEqual(calls, [["srv-abc", "search_issues", { jql: "project = X" }]]);
  assert.equal(result.output[0]?.text, "{\"issues\":[]}");
});

test("no connectors means no tools and no instructions", () => {
  const extension = mcpToolsExtension([], () => ({ list: async () => [], call: async () => "" }));
  assert.equal(extension.tools?.length, 0);
  assert.equal(extension.sections?.length, 0);
});

test("the chat agent installs tool_search and refreshes MCP tools before each turn", () => {
  const agent = readFileSync(new URL("./pi-chat-agent.ts", import.meta.url), "utf8");
  assert.match(agent, /this\.registry\.install\(createToolSearchExtension\(\)\)/);
  assert.match(agent, /await this\.refreshMcpTools\(\);\n    const receipt = await this\.harness\.submit/);
  assert.doesNotMatch(agent, /connectorToolsExtension/);
});

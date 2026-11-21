import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { createToolSearchExtension } from "@earendil-works/pi-durable/tool-search";
import { mcpToolsExtension } from "./mcp-tools";

const jira = { name: "jira__search_issues", serverId: "srv-jira", toolName: "search_issues", description: "Search Jira issues with JQL", inputSchema: { type: "object", properties: { jql: { type: "string" } }, required: ["jql"] } };
const github = { name: "github__get_pull_request", serverId: "srv-gh", toolName: "get_pull_request", description: "Read a GitHub pull request", inputSchema: { type: "object", properties: { number: { type: "number" } } } };

test("the real harness hides MCP tools until tool_search loads them, then runs them", async () => {
  const context = BACKGROUND_CONTEXT;
  const faux = fauxProvider();
  const offered: string[][] = [];
  const record = (ctx: unknown) => offered.push((ctx as { messages: Array<{ toolsAdded?: Array<{ name: string }> }> }).messages.flatMap((message) => (message.toolsAdded ?? []).map((tool) => tool.name)).sort());
  faux.setResponses([
    (ctx) => { record(ctx); return fauxAssistantMessage(fauxToolCall("tool_search", { query: "jira issues" }), { stopReason: "toolUse" }); },
    (ctx) => { record(ctx); return fauxAssistantMessage(fauxToolCall("mcp__jira__search_issues", { jql: "assignee = me" }), { stopReason: "toolUse" }); },
    (ctx) => { record(ctx); return fauxAssistantMessage("done"); },
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const calls: unknown[] = [];
  const runner = { list: async () => [jira, github], call: async (serverId: string, toolName: string, args: Record<string, unknown>) => { calls.push([serverId, toolName, args]); return "{\"issues\":[\"X-1\"]}"; } };
  const registry = createRegistry();
  registry.install(mcpToolsExtension([jira, github], () => runner));
  registry.install(createToolSearchExtension());
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
  const model = faux.getModel();
  const root = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id } } });
  const submission = await root.submit({ type: "input", content: "find my jira issues" }, context);
  const settled = await submission.wait(context);
  assert.equal(settled.status, "done");
  assert.deepEqual(offered[0], ["tool_search"]);
  assert.deepEqual(offered[1], ["mcp__jira__search_issues", "tool_search"]);
  assert.deepEqual(calls, [["srv-jira", "search_issues", { jql: "assignee = me" }]]);
  await harness.close(context);
});

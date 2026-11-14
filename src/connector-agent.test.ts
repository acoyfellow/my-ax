import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("MCP connections live on ConnectorAgent, which is not a think agent", () => {
  const agent = read("./connector-agent.ts");
  assert.match(agent, /class ConnectorAgent extends Agent</);
  assert.doesNotMatch(agent, /@cloudflare\/think/);
  for (const method of ["connectorCatalog", "connectorExplore", "connectorCallByName", "connectorCall"]) assert.match(agent, new RegExp(`async ${method}\\(`));
});

test("pi chat and the MCP explorer reach connectors through ConnectorAgent", () => {
  assert.match(read("./pi-engine/pi-chat-agent.ts"), /\(await this\.connectorAgent\(\)\)\.connectorCatalog\(\)/);
  assert.doesNotMatch(read("./routes/mcp-explore.ts"), /getSessionAgent/);
  assert.doesNotMatch(read("./routes/commands.ts"), /getSessionAgent/);
});

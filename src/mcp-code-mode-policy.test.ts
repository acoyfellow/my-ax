import assert from "node:assert/strict";
import test from "node:test";
import { parseMcpCodeModePolicy, selectMcpCodeModeProviders } from "./mcp-code-mode-policy";

const sanitize = (name: string) => name.replace(/[-.\s]/g, "_").replace(/[^a-zA-Z0-9_$]/g, "");

const policyJson = JSON.stringify({
  version: 1,
  enabled: true,
  connectors: {
    portal: { expose: ["search_records", "get_record"] },
  },
});

test("policy is disabled when absent or malformed", () => {
  assert.equal(parseMcpCodeModePolicy(undefined), null);
  assert.equal(parseMcpCodeModePolicy("{}"), null);
  assert.equal(parseMcpCodeModePolicy("not json"), null);
});

test("selection is exact and fails closed for new tools", () => {
  const policy = parseMcpCodeModePolicy(policyJson);
  assert.ok(policy);
  const providers = selectMcpCodeModeProviders({
    policy,
    servers: { server1: { name: "portal" } },
    sanitize,
    catalog: [
      { serverId: "server1", name: "search_records" },
      { serverId: "server1", name: "get_record" },
      { serverId: "server1", name: "delete_record" },
      { serverId: "server1", name: "new_tool_added_tomorrow" },
    ],
  });
  assert.deepEqual(
    providers?.[0]?.tools.map((tool) => tool.name),
    ["search_records", "get_record"],
  );
});

test("sanitized connector and method collisions disable code mode", () => {
  const connectorPolicy = parseMcpCodeModePolicy(JSON.stringify({
    version: 1,
    enabled: true,
    connectors: {
      "portal-a": { expose: ["read"] },
      portal_a: { expose: ["read"] },
    },
  }));
  assert.ok(connectorPolicy);
  assert.equal(selectMcpCodeModeProviders({
    policy: connectorPolicy,
    servers: { a: { name: "portal-a" }, b: { name: "portal_a" } },
    sanitize,
    catalog: [{ serverId: "a", name: "read" }, { serverId: "b", name: "read" }],
  }), null);

  const methodPolicy = parseMcpCodeModePolicy(JSON.stringify({
    version: 1,
    enabled: true,
    connectors: { portal: { expose: ["read-one", "read_one"] } },
  }));
  assert.ok(methodPolicy);
  assert.equal(selectMcpCodeModeProviders({
    policy: methodPolicy,
    servers: { a: { name: "portal" } },
    sanitize,
    catalog: [{ serverId: "a", name: "read-one" }, { serverId: "a", name: "read_one" }],
  }), null);
});

test("empty sanitized connector or method names disable code mode", () => {
  const policy = parseMcpCodeModePolicy(JSON.stringify({
    version: 1,
    enabled: true,
    connectors: { "!!!": { expose: ["read"] } },
  }));
  assert.ok(policy);
  assert.equal(selectMcpCodeModeProviders({
    policy,
    servers: { a: { name: "!!!" } },
    sanitize,
    catalog: [{ serverId: "a", name: "read" }],
  }), null);

  const methodPolicy = parseMcpCodeModePolicy(JSON.stringify({
    version: 1,
    enabled: true,
    connectors: { portal: { expose: ["!!!"] } },
  }));
  assert.ok(methodPolicy);
  assert.equal(selectMcpCodeModeProviders({
    policy: methodPolicy,
    servers: { a: { name: "portal" } },
    sanitize,
    catalog: [{ serverId: "a", name: "!!!" }],
  }), null);
});

test("policy caps connectors and exposed tool count", () => {
  const connectors = Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => [`c${index}`, { expose: ["read"] }]),
  );
  assert.equal(parseMcpCodeModePolicy(JSON.stringify({ version: 1, enabled: true, connectors })), null);
  assert.equal(parseMcpCodeModePolicy(JSON.stringify({
    version: 1,
    enabled: true,
    connectors: { portal: { expose: Array.from({ length: 65 }, (_, index) => `t${index}`) } },
  })), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { connectorStatusView, healthFromDiscovery, isConnectorHealth, summarizeConnectorError } from "./connector-health";
import { connectorRowDisplay } from "./ui/connector-row";

const at = "2026-09-27T12:00:00.000Z";
const rejectedRegistration = 'Dynamic Client Registration rejected (HTTP 400): {"error":"invalid_client_metadata","error_description":"redirect_uri is not allowed by the account configuration"}';

test("a saved token with a rejected registration is degraded, not connected", () => {
  const view = connectorStatusView(true, { outcome: "failed", error: summarizeConnectorError(new Error(rejectedRegistration)), checkedAt: at });
  assert.equal(view.connection, "degraded");
  assert.match(view.error ?? "", /redirect_uri is not allowed/);
  assert.equal(view.toolCount, 0);
});

test("a saved token with tools discovered is connected with a count", () => {
  const view = connectorStatusView(true, healthFromDiscovery(12, at));
  assert.equal(view.connection, "connected");
  assert.equal(view.toolCount, 12);
});

test("a server that connects but lists no tools is degraded", () => {
  const view = connectorStatusView(true, healthFromDiscovery(0, at));
  assert.equal(view.connection, "degraded");
  assert.match(view.error ?? "", /no tools/);
});

test("no token is not authorized; a token without a check yet is unchecked", () => {
  assert.equal(connectorStatusView(false, healthFromDiscovery(3, at)).connection, "not_authorized");
  assert.equal(connectorStatusView(true, null).connection, "unchecked");
});

test("errors are flattened and bounded", () => {
  const long = summarizeConnectorError(`line one\n\n${"x".repeat(1000)}`);
  assert.ok(long.length <= 300);
  assert.ok(!long.includes("\n"));
  assert.equal(summarizeConnectorError(undefined), "unknown error");
});

test("only well-formed health records are accepted by the store", () => {
  assert.equal(isConnectorHealth({ outcome: "ready", toolCount: 2, checkedAt: at }), true);
  assert.equal(isConnectorHealth({ outcome: "failed", error: "x", checkedAt: at }), true);
  assert.equal(isConnectorHealth({ outcome: "ready", checkedAt: at }), false);
  assert.equal(isConnectorHealth({ outcome: "connected", toolCount: 1, checkedAt: at }), false);
  assert.equal(isConnectorHealth(null), false);
});

test("the Settings row shows reconnect for degraded and a tool count for connected", () => {
  const degraded = connectorRowDisplay("ax-mcp", { authorized: true, connection: "degraded", error: "redirect_uri is not allowed", authorize_url: "/api/connectors/ax-mcp/authorize" });
  assert.equal(degraded.kind, "degraded");
  assert.match(degraded.kind === "degraded" ? degraded.title : "", /redirect_uri is not allowed/);
  const connected = connectorRowDisplay("ax-mcp", { authorized: true, connection: "connected", tool_count: 7 });
  assert.deepEqual(connected.kind === "connected" ? connected.toolCount : null, "7");
  assert.equal(connectorRowDisplay("ax-mcp", { authorized: false }).kind, "authorize");
  assert.equal(connectorRowDisplay("ax-mcp", { authorized: true }).kind, "pending");
});

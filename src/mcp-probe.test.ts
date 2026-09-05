import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { probeMcp } from "./mcp-probe";

test("probeMcp stays lazy until the runtime boundary executes it", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("unexpected fetch");
  };
  try {
    const program = probeMcp("not a url");
    assert.equal(calls, 0);
    const result = await Effect.runPromise(program);
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("probeMcp discovers metadata and confirms the MCP through one Effect program", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/.well-known/oauth-authorization-server")) {
      return Response.json({
        authorization_endpoint: "https://linear.app/oauth/authorize",
        token_endpoint: "https://linear.app/oauth/token",
        registration_endpoint: "https://linear.app/oauth/register",
      });
    }
    return Response.json({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "Linear" } } });
  };
  try {
    const result = await Effect.runPromise(probeMcp("https://mcp.linear.app/mcp"));
    assert.equal(result.ok, true);
    if (!result.ok) assert.fail(result.detail);
    assert.equal(result.connector.id, "linear");
    assert.equal(result.serverName, "Linear");
    assert.equal(result.dcrAvailable, true);
    assert.deepEqual(urls, [
      "https://mcp.linear.app/.well-known/oauth-authorization-server",
      "https://mcp.linear.app/mcp",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

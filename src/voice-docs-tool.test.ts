import assert from "node:assert/strict";
import test from "node:test";
import {
  searchVoiceDocs,
  VOICE_DOCS_MAX_STEPS,
  VOICE_DOCS_MCP_URL,
  VOICE_DOCS_RESULT_MAX_CHARS,
  VOICE_DOCS_SEARCH_TOOL_NAME,
} from "./voice-docs-tool";

test("voice docs search sends a credential-free bounded MCP tool request", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const result = await searchVoiceDocs("  Workers   AI limits  ", async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: "voice-docs-search",
      result: {
        content: [{
          type: "text",
          text: "Workers AI limits are documented at https://developers.cloudflare.com/workers-ai/platform/limits/.",
        }],
        structuredContent: {
          sources: ["https://developers.cloudflare.com/workers-ai/platform/limits/"],
        },
      },
    }), { status: 200 });
  });

  assert.equal(requestUrl, VOICE_DOCS_MCP_URL);
  assert.equal(requestInit?.credentials, "omit");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), null);
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    jsonrpc: "2.0",
    id: "voice-docs-search",
    method: "tools/call",
    params: {
      name: VOICE_DOCS_SEARCH_TOOL_NAME,
      arguments: { query: "Workers AI limits" },
    },
  });
  assert.deepEqual(result, {
    text: "Workers AI limits are documented at https://developers.cloudflare.com/workers-ai/platform/limits/.",
    citations: ["https://developers.cloudflare.com/workers-ai/platform/limits/"],
    maxSteps: VOICE_DOCS_MAX_STEPS,
    toolCalls: 1,
  });
});

test("voice docs search caps the tool result while retaining docs citations", async () => {
  const text = `${"x".repeat(VOICE_DOCS_RESULT_MAX_CHARS + 100)} https://developers.cloudflare.com/workers/`;
  const result = await searchVoiceDocs("Workers", async () => new Response(JSON.stringify({
    result: { content: [{ type: "text", text }] },
  }), { status: 200 }));

  assert.equal(result.maxSteps, 2);
  assert.equal(result.toolCalls, 1);
  assert.equal(result.text.length, VOICE_DOCS_RESULT_MAX_CHARS);
  assert.equal(result.text.endsWith("…"), true);
  assert.deepEqual(result.citations, ["https://developers.cloudflare.com/workers/"]);
});

test("voice docs search accepts the public MCP server event-stream response", async () => {
  const result = await searchVoiceDocs("D1", async () => new Response(
    "event: message\ndata: {\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"D1 docs: https://developers.cloudflare.com/d1/\"}]}}\n\n",
    { status: 200, headers: { "content-type": "text/event-stream" } },
  ));

  assert.equal(result.text, "D1 docs: https://developers.cloudflare.com/d1/");
  assert.deepEqual(result.citations, ["https://developers.cloudflare.com/d1/"]);
});

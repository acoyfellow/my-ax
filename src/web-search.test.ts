import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { createPublicWebSearchTool, performWebSearch } from "./web-search";

const runSearch = (...args: Parameters<typeof performWebSearch>) => Effect.runPromise(performWebSearch(...args));

test("normalizes Cloudflare Web Search results and sends only the query upstream", async () => {
  const requests: string[] = [];
  const result = await runSearch("Cloudflare Workers", {
    fetch: async (query) => {
      requests.push(query);
      return {
        items: [{
          title: "Cloudflare Workers",
          url: "https://developers.cloudflare.com/workers/",
          description: "Build serverless applications.",
          imageUrl: "https://developers.cloudflare.com/image.png",
        }],
      };
    },
  });

  assert.deepEqual(requests, ["Cloudflare Workers"]);
  assert.deepEqual(result, {
    results: [{
      title: "Cloudflare Workers",
      url: "https://developers.cloudflare.com/workers/",
      snippet: "Build serverless applications.",
    }],
    truncated: false,
  });
});

test("caps public web results and marks the response truncated", async () => {
  const result = await runSearch("Cloudflare", {
    maxResults: 3,
    fetch: async () => ({
      items: Array.from({ length: 6 }, (_, index) => ({
        title: `Result ${index + 1}`,
        url: `https://example.com/${index + 1}`,
        description: `Snippet ${index + 1}`,
      })),
    }),
  });

  assert.equal(result.results.length, 3);
  assert.deepEqual(result.results.map((item) => item.url), [
    "https://example.com/1",
    "https://example.com/2",
    "https://example.com/3",
  ]);
  assert.equal(result.truncated, true);
});

test("drops result URLs that are not absolute http or https citations", async () => {
  const result = await runSearch("citations", {
    fetch: async () => ({
      items: [
        { title: "Relative", url: "/article", description: "Not a citation" },
        { title: "FTP", url: "ftp://example.com/article", description: "Not a citation" },
        { title: "Script", url: "javascript:alert(1)", description: "Not a citation" },
        { title: "Citation", url: "http://example.com/article", description: "A citation" },
      ],
    }),
  });

  assert.deepEqual(result, {
    results: [{ title: "Citation", url: "http://example.com/article", snippet: "A citation" }],
    truncated: false,
  });
});

test("returns safe errors without exposing upstream credentials", async () => {
  const secret = "test-web-search-secret";
  const failed = await runSearch("failure", {
    fetch: async () => {
      throw new Error(`Authorization: Bearer ${secret}`);
    },
  });
  const unavailable = await runSearch("missing", {});
  const tool = createPublicWebSearchTool();
  const toolResult = await tool.execute({ query: "missing binding" }, { env: {} } as never);

  assert.deepEqual(failed, { results: [], truncated: false, error: "web_search_failed" });
  assert.deepEqual(unavailable, { results: [], truncated: false, error: "web_search_unavailable" });
  assert.equal(toolResult, JSON.stringify(unavailable));
  assert.doesNotMatch(JSON.stringify({ failed, unavailable, toolResult }), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify({ failed, unavailable, toolResult }), /Authorization/);
});

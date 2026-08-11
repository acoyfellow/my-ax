import { expect, test } from "vitest";
import { createPublicWebSearchTool, performWebSearch } from "./web-search";

test("normalizes Cloudflare Web Search results and sends only the query upstream", async () => {
  const requests: string[] = [];
  const result = await performWebSearch("Cloudflare Workers", {
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

  expect(requests).toEqual(["Cloudflare Workers"]);
  expect(result).toEqual({
    results: [{
      title: "Cloudflare Workers",
      url: "https://developers.cloudflare.com/workers/",
      snippet: "Build serverless applications.",
    }],
    truncated: false,
  });
});

test("caps public web results and marks the response truncated", async () => {
  const result = await performWebSearch("Cloudflare", {
    maxResults: 3,
    fetch: async () => ({
      items: Array.from({ length: 6 }, (_, index) => ({
        title: `Result ${index + 1}`,
        url: `https://example.com/${index + 1}`,
        description: `Snippet ${index + 1}`,
      })),
    }),
  });

  expect(result.results).toHaveLength(3);
  expect(result.results.map((item) => item.url)).toEqual([
    "https://example.com/1",
    "https://example.com/2",
    "https://example.com/3",
  ]);
  expect(result.truncated).toBe(true);
});

test("drops result URLs that are not absolute http or https citations", async () => {
  const result = await performWebSearch("citations", {
    fetch: async () => ({
      items: [
        { title: "Relative", url: "/article", description: "Not a citation" },
        { title: "FTP", url: "ftp://example.com/article", description: "Not a citation" },
        { title: "Script", url: "javascript:alert(1)", description: "Not a citation" },
        { title: "Citation", url: "http://example.com/article", description: "A citation" },
      ],
    }),
  });

  expect(result).toEqual({
    results: [{ title: "Citation", url: "http://example.com/article", snippet: "A citation" }],
    truncated: false,
  });
});

test("returns safe errors without exposing upstream credentials", async () => {
  const secret = "test-web-search-secret";
  const failed = await performWebSearch("failure", {
    fetch: async () => {
      throw new Error(`Authorization: Bearer ${secret}`);
    },
  });
  const unavailable = await performWebSearch("missing", {});
  const tool = createPublicWebSearchTool();
  const toolResult = await tool.execute({ query: "missing binding" }, { env: {} } as any);

  expect(failed).toEqual({ results: [], truncated: false, error: "web_search_failed" });
  expect(unavailable).toEqual({ results: [], truncated: false, error: "web_search_unavailable" });
  expect(toolResult).toBe(JSON.stringify(unavailable));
  expect(JSON.stringify({ failed, unavailable, toolResult })).not.toContain(secret);
  expect(JSON.stringify({ failed, unavailable, toolResult })).not.toContain("Authorization");
});

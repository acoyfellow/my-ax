import { Effect } from "effect";
import type { ToolDef } from "./types";
import { MAX_RESULTS, performWebSearch, type PublicWebSearchFetch } from "./web-search-program";

export * from "./web-search-program";

export type PublicWebSearchToolOptions = {
  fetch?: PublicWebSearchFetch;
  maxResults?: number;
};

export function createPublicWebSearchTool(options: PublicWebSearchToolOptions = {}): ToolDef {
  return {
    name: "web_search",
    description: "Search the public web through Cloudflare Web Search. Returns titles, absolute URLs, and snippets. If the Worker has no WEBSEARCH binding, returns error web_search_unavailable instead of pretending to search. Discovery only.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1, maxLength: 512, description: "Public web search query." },
        maxResults: { type: "number", minimum: 1, maximum: MAX_RESULTS, description: "Maximum results to return. Defaults to 5 and never exceeds 10." },
      },
      required: ["query"],
    },
    execute: async (args, ctx) => {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) return JSON.stringify({ results: [], truncated: false, error: "web_search_failed" });
      const webSearch = ctx.env.WEBSEARCH;
      const fetch = options.fetch ?? (typeof webSearch?.search === "function"
        ? (input: string) => webSearch.search({ query: input })
        : undefined);
      const maxResults = typeof args.maxResults === "number" ? args.maxResults : options.maxResults;
      return JSON.stringify(await Effect.runPromise(performWebSearch(query, { fetch, maxResults })));
    },
  };
}

export const PUBLIC_WEB_SEARCH_TOOL = createPublicWebSearchTool();

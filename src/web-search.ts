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
      if (!query) return JSON.stringify({ results: [], truncated: false, error: "web_search_empty_query" });
      const fetch = options.fetch ?? searchFetchFor(ctx.env);
      const maxResults = typeof args.maxResults === "number" ? args.maxResults : options.maxResults;
      return JSON.stringify(await Effect.runPromise(performWebSearch(query, { fetch, maxResults })));
    },
  };
}

type SearchEnv = {
  AI?: { websearch?: (request: { gatewayId: string; query: string; limit?: number }) => Promise<Response> };
  WEBSEARCH?: { search?: (request: { query: string }) => Promise<unknown> };
  CLOUDFLARE_AI_GATEWAY_ID?: string;
};

export const DEFAULT_WEB_SEARCH_GATEWAY = "default";

export function searchFetchFor(env: unknown): PublicWebSearchFetch | undefined {
  const bindings = env as SearchEnv;
  const ai = bindings.AI;
  if (typeof ai?.websearch === "function") {
    const gatewayId = bindings.CLOUDFLARE_AI_GATEWAY_ID?.trim() || DEFAULT_WEB_SEARCH_GATEWAY;
    return async (query) => {
      const response = await ai.websearch!({ gatewayId, query, limit: MAX_RESULTS });
      const body = await response.json() as { items?: unknown; ok?: boolean; error?: { code?: string; message?: string } };
      if (!response.ok || body.ok === false) throw new Error(body.error?.code ?? `web search returned HTTP ${response.status}`);
      return body;
    };
  }
  const legacy = bindings.WEBSEARCH;
  if (typeof legacy?.search === "function") return async (query) => await legacy.search!({ query }) as { items?: unknown };
  return undefined;
}

export const PUBLIC_WEB_SEARCH_TOOL = createPublicWebSearchTool();

import type { ToolDef } from "./types";

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 10;
const MAX_OUTPUT_BYTES = 12 * 1024;
const MAX_TITLE_CHARS = 500;
const MAX_URL_CHARS = 2_000;
const MAX_SNIPPET_CHARS = 2_000;

export type PublicWebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type PublicWebSearchResponse = {
  results: PublicWebSearchResult[];
  truncated: boolean;
  error?: "web_search_unavailable" | "web_search_failed";
};

type CloudflareSearchItem = {
  title?: unknown;
  url?: unknown;
  description?: unknown;
  snippet?: unknown;
};

type CloudflareSearchResponse = {
  items?: unknown;
};

export type PublicWebSearchFetch = (query: string) => Promise<CloudflareSearchResponse>;

export type PerformWebSearchOptions = {
  fetch?: PublicWebSearchFetch;
  maxResults?: number;
};

function clampMaxResults(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_RESULTS;
  return Math.max(1, Math.min(Math.floor(value ?? DEFAULT_MAX_RESULTS), MAX_RESULTS));
}

function normalizeText(value: unknown, maxChars: number): { text: string; truncated: boolean } {
  const text = typeof value === "string" ? value.trim() : "";
  return { text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.href.length <= MAX_URL_CHARS ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeResult(value: unknown): { result: PublicWebSearchResult; truncated: boolean } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as CloudflareSearchItem;
  const url = normalizeUrl(item.url);
  if (!url) return null;
  const title = normalizeText(item.title, MAX_TITLE_CHARS);
  const snippet = normalizeText(item.description ?? item.snippet, MAX_SNIPPET_CHARS);
  return {
    result: { title: title.text, url, snippet: snippet.text },
    truncated: title.truncated || snippet.truncated,
  };
}

function fitsOutput(results: PublicWebSearchResult[], result: PublicWebSearchResult): boolean {
  return new TextEncoder().encode(JSON.stringify({ results: [...results, result], truncated: true })).byteLength <= MAX_OUTPUT_BYTES;
}

export async function performWebSearch(query: string, options: PerformWebSearchOptions = {}): Promise<PublicWebSearchResponse> {
  const fetch = options.fetch;
  if (!fetch) return { results: [], truncated: false, error: "web_search_unavailable" };

  let response: CloudflareSearchResponse;
  try {
    response = await fetch(query);
  } catch {
    return { results: [], truncated: false, error: "web_search_failed" };
  }

  const items = Array.isArray(response?.items) ? response.items : [];
  const maxResults = clampMaxResults(options.maxResults);
  const results: PublicWebSearchResult[] = [];
  let truncated = false;

  for (const item of items) {
    const normalized = normalizeResult(item);
    if (!normalized) continue;
    if (results.length >= maxResults || !fitsOutput(results, normalized.result)) {
      truncated = true;
      break;
    }
    results.push(normalized.result);
    truncated ||= normalized.truncated;
  }

  return { results, truncated };
}

export type PublicWebSearchToolOptions = {
  fetch?: PublicWebSearchFetch;
  maxResults?: number;
};

export function createPublicWebSearchTool(options: PublicWebSearchToolOptions = {}): ToolDef {
  return {
    name: "web_search",
    description: "Search the public web through Cloudflare Web Search. Returns a bounded list of public result titles, absolute URLs, and snippets for citation. Discovery only: this tool does not open result pages, execute page content, submit forms, or change state.",
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
      return JSON.stringify(await performWebSearch(query, { fetch, maxResults }));
    },
  };
}

export const PUBLIC_WEB_SEARCH_TOOL = createPublicWebSearchTool();

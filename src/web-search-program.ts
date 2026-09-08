import { Data, Effect } from "effect";

export const DEFAULT_MAX_RESULTS = 5;
export const MAX_RESULTS = 10;
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

class WebSearchError extends Data.TaggedError("WebSearchError")<{ cause: unknown }> {}

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

export function performWebSearch(query: string, options: PerformWebSearchOptions = {}): Effect.Effect<PublicWebSearchResponse> {
  const search = options.fetch;
  if (!search) return Effect.succeed<PublicWebSearchResponse>({ results: [], truncated: false, error: "web_search_unavailable" });

  return Effect.tryPromise({
    try: () => search(query),
    catch: (cause) => new WebSearchError({ cause }),
  }).pipe(
    Effect.map((response): PublicWebSearchResponse => {
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
    }),
    Effect.catchTag("WebSearchError", () => Effect.succeed<PublicWebSearchResponse>({ results: [], truncated: false, error: "web_search_failed" })),
  );
}

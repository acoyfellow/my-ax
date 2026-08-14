export const VOICE_DOCS_MCP_URL = "https://docs.mcp.cloudflare.com/mcp";
export const VOICE_DOCS_SEARCH_TOOL_NAME = "search_cloudflare_documentation";
export const VOICE_DOCS_MAX_STEPS = 2;
export const VOICE_DOCS_RESULT_MAX_CHARS = 2_500;
const VOICE_DOCS_QUERY_MAX_CHARS = 500;

export type VoiceDocsFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface VoiceDocsSearchResult {
  text: string;
  citations: string[];
  maxSteps: typeof VOICE_DOCS_MAX_STEPS;
  toolCalls: 1;
}

function normalizeQuery(query: string): string {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error("Cloudflare Docs search requires a query.");
  return normalized.slice(0, VOICE_DOCS_QUERY_MAX_CHARS);
}

function truncateText(text: string): string {
  if (text.length <= VOICE_DOCS_RESULT_MAX_CHARS) return text;
  return `${text.slice(0, VOICE_DOCS_RESULT_MAX_CHARS - 1)}…`;
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => (part && typeof part === "object" && typeof part.text === "string" ? [part.text] : []))
    .join("\n")
    .trim();
}

function citationsFrom(value: unknown): string[] {
  const serialized = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  const citations = new Set<string>();
  for (const match of serialized.matchAll(/https:\/\/[^\s"'<>]+/g)) {
    try {
      const url = new URL(match[0].replace(/[),.;]+$/, ""));
      if (url.hostname === "developers.cloudflare.com" || url.hostname.endsWith(".cloudflare.com")) {
        citations.add(url.toString());
      }
    } catch {}
  }
  return [...citations];
}

function parseMcpPayload(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {}
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      return JSON.parse(line.slice(5).trim());
    } catch {}
  }
  throw new Error("Cloudflare Docs search is unavailable.");
}

function mcpResult(payload: unknown): { content: unknown; structuredContent: unknown } {
  if (!payload || typeof payload !== "object" || !("result" in payload)) {
    throw new Error("Cloudflare Docs search is unavailable.");
  }
  const result = payload.result;
  if (!result || typeof result !== "object") throw new Error("Cloudflare Docs search is unavailable.");
  return {
    content: "content" in result ? result.content : undefined,
    structuredContent: "structuredContent" in result ? result.structuredContent : undefined,
  };
}

export async function searchVoiceDocs(
  query: string,
  fetcher: VoiceDocsFetch = fetch,
): Promise<VoiceDocsSearchResult> {
  const response = await fetcher(VOICE_DOCS_MCP_URL, {
    method: "POST",
    credentials: "omit",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "voice-docs-search",
      method: "tools/call",
      params: {
        name: VOICE_DOCS_SEARCH_TOOL_NAME,
        arguments: { query: normalizeQuery(query) },
      },
    }),
  });
  if (!response.ok) throw new Error("Cloudflare Docs search is unavailable.");

  const payload = parseMcpPayload(await response.text());
  const result = mcpResult(payload);
  const text = textFromContent(result.content);
  if (!text) throw new Error("Cloudflare Docs search returned no results.");

  return {
    text: truncateText(text),
    citations: citationsFrom([result.content, result.structuredContent]),
    maxSteps: VOICE_DOCS_MAX_STEPS,
    toolCalls: 1,
  };
}

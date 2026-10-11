type InputItem = { type?: unknown; encrypted_content?: unknown };

export function dropUnresolvableReasoning(body: string): string {
  let parsed: { store?: unknown; input?: unknown };
  try { parsed = JSON.parse(body); } catch { return body; }
  if (parsed.store !== false || !Array.isArray(parsed.input)) return body;
  const input = (parsed.input as InputItem[]).filter((item) => {
    if (item?.type === "item_reference") return false;
    if (item?.type === "reasoning" && typeof item.encrypted_content !== "string") return false;
    return true;
  });
  if (input.length === parsed.input.length) return body;
  return JSON.stringify({ ...parsed, input });
}

export function withZdrSafeRequests(fetchImpl: typeof fetch): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init && typeof init.body === "string") return fetchImpl(url, { ...init, body: dropUnresolvableReasoning(init.body) });
    return fetchImpl(url, init);
  }) as typeof fetch;
}

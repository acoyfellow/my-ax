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
    if (init && typeof init.body === "string") {
      const body = dropUnresolvableReasoning(init.body);
      console.info("zdr_request_shape", JSON.stringify(describeInput(body)));
      return fetchImpl(url, { ...init, body });
    }
    return fetchImpl(url, init);
  }) as typeof fetch;
}

function describeInput(body: string): unknown {
  try {
    const parsed = JSON.parse(body) as { store?: unknown; previous_response_id?: unknown; input?: Array<Record<string, unknown>> };
    return { store: parsed.store, previous: parsed.previous_response_id ?? null, items: (parsed.input ?? []).map((item) => ({ type: item.type ?? item.role, id: item.id, enc: typeof item.encrypted_content === "string" })) };
  } catch { return "unparseable"; }
}

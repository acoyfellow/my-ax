type InputItem = { type?: unknown };

export function dropUnresolvableReasoning(body: string): string {
  let parsed: { store?: unknown; input?: unknown };
  try { parsed = JSON.parse(body); } catch { return body; }
  if (!Array.isArray(parsed.input)) return body;
  const input = (parsed.input as InputItem[]).filter((item) => item?.type !== "item_reference" && item?.type !== "reasoning");
  if (parsed.store === false && input.length === parsed.input.length) return body;
  return JSON.stringify({ ...parsed, store: false, input });
}

export function withZdrSafeRequests(fetchImpl: typeof fetch): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init && typeof init.body === "string") {
      const body = dropUnresolvableReasoning(init.body);
      return annotateZdrError(await fetchImpl(url, { ...init, body }), body);
    }
    return fetchImpl(url, init);
  }) as typeof fetch;
}

export function describeRequestItems(body: string): string {
  try {
    const parsed = JSON.parse(body) as { store?: unknown; previous_response_id?: unknown; input?: Array<Record<string, unknown>> };
    const items = (parsed.input ?? []).map((item) => `${String(item.type ?? item.role)}${typeof item.id === "string" ? `:${item.id.slice(0, 12)}` : ""}${typeof item.encrypted_content === "string" ? "+enc" : ""}`);
    return `store=${String(parsed.store)} prev=${String(parsed.previous_response_id ?? "-")} items=[${items.join(",")}]`;
  } catch { return "unparseable"; }
}

export async function annotateZdrError(response: Response, body: string): Promise<Response> {
  if (response.ok) return response;
  const text = await response.text();
  if (!text.includes("Zero Data Retention")) return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
  const shape = describeRequestItems(body);
  let annotated = `${text} [request ${shape}]`;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed.error?.message) { parsed.error.message = `${parsed.error.message} [request ${shape}]`; annotated = JSON.stringify(parsed); }
  } catch {}
  return new Response(annotated, { status: response.status, statusText: response.statusText, headers: response.headers });
}

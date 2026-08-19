export function rewriteFileUrl(raw: string, origin: string): string | null {
  if (raw.startsWith("data:")) return raw;
  try {
    const url = new URL(raw, origin.replace(/\/+$/, ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function healUiHistoryFileUrls(messages: Array<{ parts?: Array<Record<string, unknown>> }>, origin: string): number {
  const base = origin.replace(/\/+$/, "");
  if (!base) return 0;
  let rewritten = 0;
  for (const message of messages) {
    if (!Array.isArray(message.parts)) continue;
    let changed = false;
    const next = message.parts.flatMap((part) => {
      if (!part || typeof part !== "object") return [part];
      if (part.type !== "file" && part.type !== "image" && part.type !== "source") return [part];
      if (typeof part.url !== "string") {
        if (part.type === "image" && typeof part.data === "string" && !part.data.startsWith("data:image/") && !/^https?:\/\//i.test(part.data)) {
          changed = true;
          return [];
        }
        return [part];
      }
      const url = rewriteFileUrl(part.url, base);
      if (!url) {
        changed = true;
        return [];
      }
      if (url === part.url) return [part];
      changed = true;
      return [{ ...part, url }];
    });
    if (!changed) continue;
    message.parts = next;
    rewritten += 1;
  }
  return rewritten;
}

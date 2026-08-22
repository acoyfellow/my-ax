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

export function absoluteFileUrl(raw: string): string | null {
  if (raw.startsWith("data:")) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function healUiHistoryFileUrls(messages: Array<{ parts?: Array<Record<string, unknown>> }>, origin: string): number {
  const base = origin.replace(/\/+$/, "");
  let rewritten = 0;
  for (const message of messages) {
    if (!Array.isArray(message.parts)) continue;
    let changed = false;
    const next = message.parts.flatMap((part) => {
      if (!part || typeof part !== "object") return [part];
      const media = typeof part.mediaType === "string" ? part.mediaType : typeof part.mimeType === "string" ? part.mimeType : "";
      const isImage = part.type === "file" || part.type === "image" || part.type === "source" || /image\//i.test(media);
      if (!isImage) return [part];
      if (typeof part.url !== "string") {
        if (typeof part.data === "string" && (part.data.startsWith("data:image/") || /^https?:\/\//i.test(part.data))) return [part];
        if (part.data != null || media.startsWith("image/")) {
          changed = true;
          return [];
        }
        return [part];
      }
      const url = base ? rewriteFileUrl(part.url, base) : absoluteFileUrl(part.url);
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

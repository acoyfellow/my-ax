export interface UiHistoryPart {
  type?: string;
  url?: unknown;
  [key: string]: unknown;
}

export interface UiHistoryMessage {
  parts?: UiHistoryPart[];
  [key: string]: unknown;
}

function absolutePublicUrl(raw: string, origin: string): string | null {
  if (raw.startsWith("data:")) return raw;
  try {
    const url = new URL(raw, origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function rewriteUiHistoryFileUrls<T extends UiHistoryMessage>(messages: T[], origin: string): T[] {
  const base = origin.replace(/\/+$/, "");
  if (!base) return messages;
  return messages.map((message) => {
    if (!Array.isArray(message.parts)) return message;
    let changed = false;
    const parts = message.parts.flatMap((part) => {
      if (!part || typeof part !== "object") return [part];
      if (part.type !== "file" && part.type !== "image" && part.type !== "source") return [part];
      if (typeof part.url !== "string") return [part];
      const next = absolutePublicUrl(part.url, base);
      if (!next) {
        changed = true;
        return [];
      }
      if (next === part.url) return [part];
      changed = true;
      return [{ ...part, url: next }];
    });
    return changed ? { ...message, parts } : message;
  });
}

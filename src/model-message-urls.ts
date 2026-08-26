import type { ModelMessage } from "ai";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function looksLikeImage(value: string): boolean {
  if (value.startsWith("data:image/")) return true;
  if (isHttpUrl(value)) return /\.(avif|gif|jpe?g|png|webp)(\?|$)/i.test(value) || /image\//i.test(value);
  return false;
}

function isBinaryData(value: unknown): boolean {
  return value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function sanitizePart(part: unknown): unknown | null {
  if (!part || typeof part !== "object") return part;
  const item = part as { type?: unknown; url?: unknown; data?: unknown; mediaType?: unknown; mimeType?: unknown };
  const kind = typeof item.type === "string" ? item.type : "";
  const media = typeof item.mediaType === "string" ? item.mediaType : typeof item.mimeType === "string" ? item.mimeType : "";
  const isImage = kind === "image" || kind === "file" || kind === "source" || /image\//i.test(media);
  if (!isImage) return part;
  if (typeof item.url === "string") {
    if (item.url.startsWith("data:image/")) return part;
    if (isHttpUrl(item.url) && looksLikeImage(item.url)) return part;
    return null;
  }
  if (typeof item.data === "string") {
    if (looksLikeImage(item.data)) return part;
    return null;
  }
  if (isBinaryData(item.data)) return part;
  if (item.url != null || item.data != null) return null;
  return part;
}

export function sanitizeModelMessageUrls(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    const next = message.content.map(sanitizePart).filter((part) => part !== null);
    if (next.length === message.content.length && next.every((part, index) => part === message.content[index])) return message;
    return { ...message, content: next } as ModelMessage;
  });
}

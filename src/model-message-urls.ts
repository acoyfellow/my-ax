import type { ModelMessage } from "ai";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizePart(part: unknown): unknown | null {
  if (!part || typeof part !== "object") return part;
  const item = part as { type?: unknown; url?: unknown; data?: unknown };
  if (item.type !== "file" && item.type !== "image" && item.type !== "source") return part;
  if (typeof item.url === "string" && !isHttpUrl(item.url) && !item.url.startsWith("data:")) return null;
  if (typeof item.data === "string" && (item.data.startsWith("http") || item.data.startsWith("/")) && !isHttpUrl(item.data) && !item.data.startsWith("data:")) return null;
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

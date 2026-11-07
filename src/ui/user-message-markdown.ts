import { Marked } from "marked";
import type { DOMPurify as Purifier } from "dompurify";
import { sanitizeRenderedMarkdown } from "./safe-markdown";

const userMarked = new Marked({ gfm: true, breaks: true });

export function renderUserMarkdown(content: unknown, purifier?: Purifier): string {
  const text = typeof content === "string" ? content : String(content ?? "");
  const html = userMarked.parse(text, { async: false });
  return purifier ? sanitizeRenderedMarkdown(html, purifier) : sanitizeRenderedMarkdown(html);
}

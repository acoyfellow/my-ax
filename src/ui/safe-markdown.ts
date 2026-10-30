import createDOMPurify, { type DOMPurify as Purifier, type WindowLike } from "dompurify";

const SAFE_URL = /^(?:https?:|mailto:|\/(?!\/)|#|\?|\.{0,2}\/)/i;

let browserPurifier: Purifier | null = null;

export function purifierFor(window: WindowLike): Purifier {
  return createDOMPurify(window);
}

function defaultPurifier(): Purifier {
  browserPurifier ??= purifierFor(globalThis.window as unknown as WindowLike);
  return browserPurifier;
}

export function sanitizeRenderedMarkdown(html: string, purifier: Purifier = defaultPurifier()): string {
  const clean = purifier.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed", "svg", "math"],
    FORBID_ATTR: ["style", "srcset", "formaction"],
    ALLOWED_URI_REGEXP: SAFE_URL,
  });
  return clean;
}

export function hardenLinks(container: ParentNode): void {
  container.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href") ?? "";
    if (/^https?:/i.test(href)) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    }
  });
}

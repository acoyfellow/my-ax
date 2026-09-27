import { myAxDeepLinkIntent, parseMyAxDeepLink } from "./ui/deep-links";

export function isExternalSourceHref(raw: string | null | undefined, currentHref: string): boolean {
  if (!raw || !/^https:\/\//i.test(raw)) return false;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return false;
    return url.origin !== new URL(currentHref).origin;
  } catch {
    return false;
  }
}

export function attentionSourceLabel(href: string | null, currentHref: string): string | null {
  if (!href) return null;
  if (isExternalSourceHref(href, currentHref)) return "Open source";
  const target = parseMyAxDeepLink(href, currentHref);
  if (!target) return null;
  if (target.sessionId) return "Open conversation";
  if (/^\/runs\//.test(target.href)) return "Open run";
  if (target.action === "settings") return "Open settings";
  if (myAxDeepLinkIntent(target).kind === "preserve") return null;
  return "Open source";
}

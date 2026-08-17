import { myAxDeepLinkIntent, parseMyAxDeepLink } from "./ui/deep-links";

const EXTERNAL_HOSTS = new Set(["gitlab.cfdata.org", "github.com", "www.github.com"]);

export function isExternalSourceHref(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    return EXTERNAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function attentionSourceLabel(href: string | null, currentHref: string): string | null {
  if (!href) return null;
  if (isExternalSourceHref(href)) return "Open source";
  const target = parseMyAxDeepLink(href, currentHref);
  if (!target) return null;
  if (target.sessionId) return "Open conversation";
  if (/^\/runs\//.test(target.href)) return "Open run";
  if (target.action === "settings") return "Open settings";
  if (myAxDeepLinkIntent(target).kind === "preserve") return null;
  return "Open source";
}

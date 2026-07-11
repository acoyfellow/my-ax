export type MyAxDeepLink = {
  href: string;
  sessionId: string | null;
  action: string | null;
};

/** Parse only same-origin app links. Notification, Attention, and launch
 * handlers share this contract so a deep link cannot silently become an
 * external navigation or fall back to the currently cached conversation. */
export function parseMyAxDeepLink(rawHref: string, currentHref: string): MyAxDeepLink | null {
  try {
    const current = new URL(currentHref);
    const target = new URL(rawHref || "/", current.origin);
    // Reject cross-origin AND scheme-relative (//host) targets: the latter
    // parses same-origin here but re-navigates cross-origin when the returned
    // href is reparsed against the app origin.
    if (target.origin !== current.origin || target.pathname.startsWith("//")) return null;
    return {
      href: `${target.pathname}${target.search}${target.hash}`,
      sessionId: target.searchParams.get("session"),
      action: target.searchParams.get("action"),
    };
  } catch {
    return null;
  }
}

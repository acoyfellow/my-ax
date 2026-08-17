export type MyAxDeepLink = {
  href: string;
  sessionId: string | null;
  action: string | null;
  attentionId: string | null;
};

export type MyAxDeepLinkIntent =
  | { kind: "preserve" }
  | { kind: "session"; sessionId: string }
  | { kind: "attention"; attentionId: string | null }
  | { kind: "settings" }
  | { kind: "desk" }
  | { kind: "run-receipt"; runId: string }
  | { kind: "navigate"; href: string };

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
      attentionId: target.searchParams.get("attentionId"),
    };
  } catch {
    return null;
  }
}

export function myAxDeepLinkIntent(target: MyAxDeepLink): MyAxDeepLinkIntent {
  if (target.sessionId) return { kind: "session", sessionId: target.sessionId };
  if (target.action === "attention") return { kind: "attention", attentionId: target.attentionId };
  if (target.action === "settings") return { kind: "settings" };
  if (target.action === "desk") return { kind: "desk" };
  const receiptMatch = /^\/runs\/([^/?#]+)$/.exec(target.href.split("?")[0].split("#")[0]);
  if (receiptMatch) return { kind: "run-receipt", runId: decodeURIComponent(receiptMatch[1]) };
  if (target.href === "/") return { kind: "preserve" };
  return { kind: "navigate", href: target.href };
}

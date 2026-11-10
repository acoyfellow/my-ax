export type PipWindowOptions = { width: number; height: number };

export type DocumentPictureInPicture = {
  requestWindow(options: PipWindowOptions): Promise<Window>;
  window: Window | null;
};

export const ROOT_PIP_SIZE: PipWindowOptions = { width: 420, height: 640 };

export function documentPip(host: unknown): DocumentPictureInPicture | null {
  const candidate = (host as { documentPictureInPicture?: unknown } | null)?.documentPictureInPicture;
  if (!candidate || typeof (candidate as DocumentPictureInPicture).requestWindow !== "function") return null;
  return candidate as DocumentPictureInPicture;
}

type StyleSource = { href?: string | null; ownerNode?: unknown; cssRules?: ArrayLike<{ cssText: string }> };

export type CopiedStyle = { kind: "link"; href: string } | { kind: "inline"; css: string };

export function copiedStyles(sheets: ArrayLike<StyleSource>): CopiedStyle[] {
  const copies: CopiedStyle[] = [];
  for (const sheet of Array.from(sheets)) {
    try {
      const rules = sheet.cssRules ? Array.from(sheet.cssRules).map((rule) => rule.cssText).join("\n") : "";
      if (rules) { copies.push({ kind: "inline", css: rules }); continue; }
    } catch {}
    if (sheet.href) copies.push({ kind: "link", href: sheet.href });
  }
  return copies;
}

export const MIRRORED_ROOT_ATTRIBUTES = ["class", "data-theme", "style", "lang"] as const;

export function mirroredAttributes(source: { getAttribute(name: string): string | null }): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const name of MIRRORED_ROOT_ATTRIBUTES) {
    const value = source.getAttribute(name);
    if (value !== null) pairs.push([name, value]);
  }
  return pairs;
}

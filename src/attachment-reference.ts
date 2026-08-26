export type AttachmentReferencePart = {
  type?: unknown;
  url?: unknown;
  data?: unknown;
  mediaType?: unknown;
  filename?: unknown;
};

export function uploadPathFromPart(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const item = part as AttachmentReferencePart;
  if (item.type !== "file") return null;
  for (const candidate of [item.url, item.data]) {
    if (typeof candidate === "string" && candidate.startsWith("/api/uploads/")) return candidate;
  }
  return null;
}

export function partReferencesKnownUpload(part: unknown, knownPaths: ReadonlySet<string>): boolean {
  const path = uploadPathFromPart(part);
  return path !== null && knownPaths.has(path);
}

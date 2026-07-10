export interface DeploymentVersionMetadata {
  id?: string | null;
  timestamp?: string | null;
}

function etagFor(id: string): string {
  return `"${id.replace(/["\\]/g, "")}"`;
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((value) => {
    const candidate = value.trim().replace(/^W\//, "");
    return candidate === etag || candidate === "*";
  });
}

/** Cheap, storage-free deployment probe backed by Workers Version Metadata. */
export function deploymentVersionResponse(
  metadata: DeploymentVersionMetadata | undefined,
  ifNoneMatch?: string,
): Response {
  const id = metadata?.id ?? "dev";
  const etag = etagFor(id);
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    ETag: etag,
    "X-My-Ax-Version": id,
  });
  if (metadata?.timestamp) headers.set("X-My-Ax-Version-Timestamp", metadata.timestamp);
  return new Response(null, { status: etagMatches(ifNoneMatch, etag) ? 304 : 200, headers });
}

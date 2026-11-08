const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function normalizeComputerId(raw: string): string {
  const id = raw.trim().toLowerCase();
  if (!ID_RE.test(id)) throw new Error("computer id must be 1–63 chars of lowercase letters, digits, and hyphens");
  return id;
}

export function computerSandboxName(ownerEmail: string, computerId: string): string {
  return `${ownerEmail.toLowerCase()}::computer::${normalizeComputerId(computerId)}`;
}

export function shouldRestoreComputerSnapshot(restoreLatest: boolean | undefined, readyExitCode: number | null): boolean {
  if (restoreLatest === false) return false;
  return readyExitCode !== 0;
}

export function screenContainerPath(requestPath: string, computerId: string): string {
  const prefix = `/api/computers/${computerId}/screen`;
  if (!requestPath.startsWith(prefix + "/") && requestPath !== prefix) {
    throw new Error("screen path is outside the computer proxy");
  }
  const rest = requestPath === prefix ? "/" : requestPath.slice(prefix.length);
  if (!rest.startsWith("/") || rest.includes("..") || rest.startsWith("//")) {
    throw new Error("screen path is not allowed");
  }
  return rest;
}

export function computerPreviewSrc(computerId: string): string {
  return `/api/computers/${normalizeComputerId(computerId)}/screen/`;
}

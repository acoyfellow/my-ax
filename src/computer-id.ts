const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function normalizeComputerId(raw: string): string {
  const id = raw.trim().toLowerCase();
  if (!ID_RE.test(id)) throw new Error("computer id must be 1–63 chars of lowercase letters, digits, and hyphens");
  return id;
}

export function computerSandboxName(ownerEmail: string, computerId: string): string {
  return `${ownerEmail.toLowerCase()}::computer::${normalizeComputerId(computerId)}`;
}

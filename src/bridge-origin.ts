export function resolveBridgeOrigin(raw: string | undefined | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    if (trimmed.includes("://")) return null;
    try {
      return new URL(`https://${trimmed}`).origin;
    } catch {
      return null;
    }
  }
}

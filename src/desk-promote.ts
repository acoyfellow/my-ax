export interface ArtifactSummary {
  id: string;
  title: string;
}

export interface PromotionPreview {
  artifactId: string;
  title: string;
  replaces: ArtifactSummary | null;
  isNoop: boolean;
  summary: string;
}

export class DeskPromoteError extends Error {}

export function describePromotion(
  incoming: ArtifactSummary,
  current: ArtifactSummary | null,
): PromotionPreview {
  if (!incoming.id) throw new DeskPromoteError("promote needs an artifact id");
  const isNoop = current?.id === incoming.id;
  const summary = isNoop
    ? `“${incoming.title}” is already the desk app.`
    : current
      ? `Put “${incoming.title}” on the desk and take down “${current.title}”. The desk holds one app.`
      : `Put “${incoming.title}” on the desk. The desk is empty right now.`;
  return { artifactId: incoming.id, title: incoming.title, replaces: isNoop ? null : current, isNoop, summary };
}

export function promotionConfirmed(preview: PromotionPreview, acknowledgedId: string | null): boolean {
  if (preview.isNoop) return true;
  if (!preview.replaces) return true;
  return acknowledgedId === preview.replaces.id;
}

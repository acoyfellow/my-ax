export const TOP_DRAWER_OPEN_FRACTION = 0.3;

export function dragOffset(startY: number, currentY: number, height: number, direction: "open" | "close"): number {
  const delta = currentY - startY;
  if (direction === "open") return Math.max(0, Math.min(height, delta));
  return Math.max(0, Math.min(height, height + delta));
}

export function settlesOpen(offset: number, height: number): boolean {
  return height > 0 && offset / height >= 1 - TOP_DRAWER_OPEN_FRACTION;
}

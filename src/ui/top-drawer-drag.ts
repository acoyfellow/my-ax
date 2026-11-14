export const TOP_DRAWER_OPEN_FRACTION = 0.3;

export function dragOffset(startY: number, currentY: number, height: number, direction: "open" | "close"): number {
  const delta = currentY - startY;
  if (direction === "open") return Math.max(0, Math.min(height, delta));
  return Math.max(0, Math.min(height, height + delta));
}

export function settlesOpen(offset: number, height: number): boolean {
  return height > 0 && offset / height >= 1 - TOP_DRAWER_OPEN_FRACTION;
}

export const FLICK_VELOCITY = 0.4;
export const BACKGROUND_SCALE = 0.94;

export function rubberBand(overshoot: number, limit = 60): number {
  if (overshoot <= 0) return 0;
  return limit * (1 - Math.exp(-overshoot / (limit * 2)));
}

export function velocityOf(samples: ReadonlyArray<{ y: number; t: number }>): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const first = samples.find((sample) => last.t - sample.t <= 100) ?? samples[0];
  const elapsed = last.t - first.t;
  return elapsed > 0 ? (last.y - first.y) / elapsed : 0;
}

export function settlesOpenAfterRelease(offset: number, height: number, velocity: number): boolean {
  if (velocity >= FLICK_VELOCITY) return true;
  if (velocity <= -FLICK_VELOCITY) return false;
  return settlesOpen(offset, height);
}

export function revealProgress(offset: number, height: number): number {
  return height > 0 ? Math.max(0, Math.min(1, offset / height)) : 0;
}

export function backgroundScale(progress: number): number {
  return 1 - (1 - BACKGROUND_SCALE) * progress;
}

export const TAP_SLOP_PX = 10;

export type DrawerRelease = "tap" | "open" | "close";

export function releaseOutcome(input: { direction: "open" | "close"; travel: number; cancelled: boolean; offset: number; height: number; velocity: number }): DrawerRelease {
  const isTap = Math.abs(input.travel) <= TAP_SLOP_PX;
  if (isTap) return input.direction === "open" && !input.cancelled ? "tap" : input.direction === "open" ? "close" : "open";
  if (input.cancelled) return input.direction === "open" ? "close" : "open";
  return settlesOpenAfterRelease(input.offset, input.height, input.velocity) ? "open" : "close";
}

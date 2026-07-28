// Pure webcam-frame helpers (#10 agent vision). The Svelte layer owns
// getUserMedia + the <video>/<canvas> elements; this module holds the testable
// geometry/config/naming so a captured frame stays bounded and well under the
// /api/uploads 10MB image cap. No DOM device access here.

export type CaptureConfig = { maxWidth: number; mimeType: string; quality: number };

/** Bounded JPEG capture config: 1280px wide, q0.8 — a full frame is ~100-300KB,
 *  far under the 10MB upload cap, and readable by the model. */
export function captureConfig(): CaptureConfig {
  return { maxWidth: 1280, mimeType: "image/jpeg", quality: 0.8 };
}

/** Stable, sortable filename for a captured frame. */
export function frameFilename(now: number = Date.now()): string {
  return `webcam-${now}.jpg`;
}

/** Compute the draw dimensions for a source video, preserving aspect ratio and
 *  clamping the width to cfg.maxWidth. Returns {width,height} (integers).
 *  Returns null for a zero/invalid source (no frame yet). Pure. */
export function frameDimensions(
  sourceWidth: number,
  sourceHeight: number,
  cfg: CaptureConfig = captureConfig(),
): { width: number; height: number } | null {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return null;
  const scale = sourceWidth > cfg.maxWidth ? cfg.maxWidth / sourceWidth : 1;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return { width, height };
}

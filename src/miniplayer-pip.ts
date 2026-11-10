export type PipSupport = "pip" | "fallback";

export function pipSupport(userAgent: string): PipSupport {
  // Empty string or falsy returns fallback
  if (!userAgent) {
    return "fallback";
  }

  const ua = userAgent.toLowerCase();

  // Check for mobile Chromium (Android Chrome, etc.) - these are fallback
  if (ua.includes("android") || ua.includes("mobile")) {
    return "fallback";
  }

  // Check for Chromium-based desktop browsers
  if (
    ua.includes("chrome") ||
    ua.includes("edg") || // "edg" matches "edge" and "edgium"
    ua.includes("opera") ||
    ua.includes("brave")
  ) {
    return "pip";
  }

  // Safari, Firefox, and other browsers
  return "fallback";
}

export function pipSize(viewportW: number): { width: number; height: number } {
  // Clamp width to [280, 420]
  const width = viewportW <= 0 ? 280 : Math.max(280, Math.min(420, viewportW));

  // Height is width * 9 / 16 rounded to whole pixels
  const height = Math.round((width * 9) / 16);

  return { width, height };
}

export function pipLabel(turn: "working" | "idle" | "stuck"): string {
  switch (turn) {
    case "working":
      return "Working";
    case "idle":
      return "Idle";
    case "stuck":
      return "Needs you";
  }
}

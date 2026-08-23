export const DEFAULT_PREVIEW_HOST_SUFFIX = "";

function hostSuffix(): string {
  const configured = (globalThis as { PREVIEW_HOST_SUFFIX?: string }).PREVIEW_HOST_SUFFIX;
  return typeof configured === "string" && configured !== "" ? configured : DEFAULT_PREVIEW_HOST_SUFFIX;
}

export function previewHostForPull(pullNumber: number, suffix = hostSuffix()): string {
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw new Error("a preview host needs a positive pull number");
  }
  if (!suffix) throw new Error("the preview host suffix is not configured");
  return `pr-${pullNumber}${suffix}`;
}

export interface PreviewCheck {
  url: string;
  status: number;
  version?: string;
}

export function previewUrlForPull(pullNumber: number, suffix = hostSuffix()): string {
  return `https://${previewHostForPull(pullNumber, suffix)}`;
}

export function isPreviewUrlForPull(url: string, pullNumber: number, suffix = hostSuffix()): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return parsed.hostname === previewHostForPull(pullNumber, suffix);
  } catch {
    return false;
  }
}

export function previewFindings(
  input: { number?: number; head?: string; preview?: PreviewCheck },
  suffix = hostSuffix(),
): { ok: boolean; findings: string[] } {
  const pullNumber = input.number ?? 0;
  const preview = input.preview;

  if (!preview) {
    return { ok: false, findings: ["preview missing; deploy the head to its preview host and re-check"] };
  }
  if (!isPreviewUrlForPull(preview.url, pullNumber, suffix)) {
    return { ok: false, findings: [`preview URL does not belong to this pull request: expected the pr-${pullNumber} preview host`] };
  }
  if (preview.status !== 200) {
    return { ok: false, findings: [`preview did not answer 200 (got ${preview.status})`] };
  }
  if (!preview.version) {
    return { ok: false, findings: ["the preview did not report a deployed version"] };
  }
  if (!input.head) {
    return { ok: false, findings: ["cannot confirm the preview runs this head; head is unknown"] };
  }
  if (!preview.version.startsWith(input.head.slice(0, 7))) {
    return { ok: false, findings: [`the preview runs ${preview.version.slice(0, 7)}, not this head`] };
  }

  return { ok: true, findings: [`verified against the live preview for this pull request, running ${preview.version.slice(0, 7)}`] };
}

// Trusted inline tool-result widget registry.
//
// Tool output is model-adjacent data. Never turn arbitrary output into HTML,
// iframe src values, or dynamic component names. Each widget type is an
// explicit allowlisted projection with bounded fields and safe fallbacks.

const INLINE_IMAGE_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,\s*([A-Za-z0-9+/=\r\n\t ]+)\s*$/;
// A physical-laptop screenshot can be a full Retina PNG. Keep the allowlist
// narrow, but leave enough room for the real machinectl screenshot payload
// instead of falling back to a massive raw base64 transcript.
const MAX_INLINE_IMAGE_URL_CHARS = 32_000_000;
const INTERNAL_BROWSER_REPLAY_RE = /^\/browser\/replay\/[A-Za-z0-9._~%+-]+$/;
const INTERNAL_RASTER_ARTIFACT_RE = /^\/api\/artifacts\/[0-9a-f-]{36}$/i;
const INTERNAL_SVELTE_ARTIFACT_RE = /^\/api\/artifacts\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/preview$/i;
const MAX_BROWSER_TEXT_CHARS = 2_000;

export type ToolResultWidget =
  | {
      kind: "delegation-group";
      runs: Array<{
        runId?: string;
        taskFingerprint?: string;
        label?: string;
        status: "pending" | "completed" | "error" | "interrupted" | "aborted";
        summary?: string;
        error?: string;
        attempts?: number;
        details?: string;
      }>;
      live: boolean;
    }
  | {
      kind: "browser-run";
      status: "done" | "error";
      heading: string;
      title?: string;
      url?: string;
      text?: string;
      screenshotSrc?: string;
      replaySrc?: string;
    }
  | { kind: "inline-raster-image"; src: string; alt: string }
  | { kind: "svelte-artifact"; src: string; title: string; artifactId: string }
  | { kind: "saved-recipe-candidate"; ok: boolean; sourceCode: string; capabilities: string[]; resultPreview?: string; saveEndpoint: string }
  | { kind: "raw-text"; text: string };

function decodeJsonOnce(value: unknown): unknown {
  if (typeof value !== "string" || !value.startsWith("{")) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function boundedText(value: unknown, max = MAX_BROWSER_TEXT_CHARS): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function inlineRasterImageSrc(value: unknown): string | null {
  if (typeof value === "string") {
    if (value.length > MAX_INLINE_IMAGE_URL_CHARS) return null;
    // Some tool transports preserve harmless whitespace after the comma or
    // wrap the base64 body. Normalize it before giving the URL to <img> so a
    // machinectl screenshot never degrades into a raw base64 dump.
    const match = value.trim().match(INLINE_IMAGE_RE);
    if (match) return "data:" + match[1] + ";base64," + match[2].replace(/\s+/g, "");
    const decoded = decodeJsonOnce(value.trim());
    return decoded === value ? null : inlineRasterImageSrc(decoded);
  }
  if (typeof value === "object" && value !== null) {
    // Direct machinectl_call outputs wrap the payload in content; the
    // preferred machinectl_code surface wraps returned method values in
    // result. Both paths remain constrained to validated raster data URLs.
    if ("content" in value) return inlineRasterImageSrc((value as { content?: unknown }).content);
    if ("result" in value) return inlineRasterImageSrc((value as { result?: unknown }).result);
  }
  return null;
}

function rasterArtifactWidget(value: unknown, toolName: string): ToolResultWidget | null {
  const decoded = decodeJsonOnce(value);
  if (typeof decoded !== "object" || decoded === null) return null;
  if ("content" in decoded) return rasterArtifactWidget((decoded as { content?: unknown }).content, toolName);
  // machinectl_code returns { ok, result: <codemode method return>, logs }.
  if ("result" in decoded) return rasterArtifactWidget((decoded as { result?: unknown }).result, toolName);
  const result = decoded as Record<string, unknown>;
  if (result.kind !== "raster-artifact" || typeof result.src !== "string" || !INTERNAL_RASTER_ARTIFACT_RE.test(result.src)) return null;
  return { kind: "inline-raster-image", src: result.src, alt: `${toolName} screenshot` };
}

function svelteArtifactWidget(value: unknown): ToolResultWidget | null {
  const decoded = decodeJsonOnce(value);
  if (typeof decoded !== "object" || decoded === null) return null;
  if ("content" in decoded) return svelteArtifactWidget((decoded as { content?: unknown }).content);
  if ("result" in decoded) return svelteArtifactWidget((decoded as { result?: unknown }).result);
  const result = decoded as Record<string, unknown>;
  const match = typeof result.src === "string" ? result.src.match(INTERNAL_SVELTE_ARTIFACT_RE) : null;
  if (result.kind !== "svelte-artifact" || !match || typeof result.artifactId !== "string" || result.artifactId.toLowerCase() !== match[1].toLowerCase()) return null;
  return { kind: "svelte-artifact", src: result.src as string, title: boundedText(result.title, 120) ?? "Interactive artifact", artifactId: result.artifactId };
}

function delegationGroupWidget(value: unknown, toolName: string): ToolResultWidget | null {
  if (toolName !== "delegate_many") return null;
  const decoded = decodeJsonOnce(value);
  if (typeof decoded !== "object" || decoded === null) return null;
  if ("content" in decoded) return delegationGroupWidget((decoded as { content?: unknown }).content, toolName);
  if ("result" in decoded && !Array.isArray((decoded as { results?: unknown }).results)) {
    return delegationGroupWidget((decoded as { result?: unknown }).result, toolName);
  }
  const results = (decoded as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;
  const statuses = new Set(["pending", "completed", "error", "interrupted", "aborted"]);
  const runs = results.slice(0, 2).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const run = item as Record<string, unknown>;
    if (typeof run.status !== "string" || !statuses.has(run.status)) return [];
    const detailsValue = run.output;
    let details: string | undefined;
    if (detailsValue !== undefined) {
      try { details = JSON.stringify(detailsValue, null, 2).slice(0, 4_000); } catch { details = String(detailsValue).slice(0, 4_000); }
    }
    return [{
      runId: boundedText(run.runId, 200),
      taskFingerprint: boundedText(run.taskFingerprint, 200),
      label: boundedText(run.label, 80),
      status: run.status as "pending" | "completed" | "error" | "interrupted" | "aborted",
      summary: boundedText(run.summary, 500),
      error: boundedText(run.error, 500),
      attempts: typeof run.attempts === "number" && Number.isInteger(run.attempts) ? Math.max(1, Math.min(2, run.attempts)) : undefined,
      details,
    }];
  });
  return runs.length ? { kind: "delegation-group", runs, live: false } : null;
}

function browserRunWidget(value: unknown): ToolResultWidget | null {
  const decoded = decodeJsonOnce(value);
  if (typeof decoded !== "object" || decoded === null || !("kind" in decoded)) return null;
  const result = decoded as Record<string, unknown>;
  if (result.kind !== "browser-run") return null;

  const status = result.status === "done" ? "done" : "error";
  const replayUrl = boundedText(result.replayUrl, 500);
  // Only same-origin app-owned replay routes may become iframe sources. An
  // arbitrary tool result can never make the chat client embed an external URL.
  const replaySrc = replayUrl && INTERNAL_BROWSER_REPLAY_RE.test(replayUrl)
    ? `${replayUrl}?embed=1`
    : undefined;
  const screenshot = boundedText(result.screenshotSrc, 500);
  const screenshotSrc = screenshot && INTERNAL_RASTER_ARTIFACT_RE.test(screenshot) ? screenshot : undefined;

  return {
    kind: "browser-run",
    status,
    heading: status === "done" ? "Browser run completed" : "Browser run failed",
    title: boundedText(result.title, 300),
    url: boundedText(result.url, 1_000),
    text: boundedText(result.textPreview ?? result.error),
    screenshotSrc,
    replaySrc,
  };
}

function savedRecipeCandidateWidget(value: unknown, toolName: string): ToolResultWidget | null {
  if (toolName !== "work_code") return null;
  const decoded = decodeJsonOnce(value);
  if (typeof decoded !== "object" || decoded === null) return null;
  const result = decoded as Record<string, unknown>;
  if (typeof result.sourceCode !== "string" || !Array.isArray(result.inferredCapabilities) || !("suggestedRecipe" in result)) return null;
  const capabilities = result.inferredCapabilities.filter((item): item is string => typeof item === "string").slice(0, 24);
  let resultPreview: string | undefined;
  try { resultPreview = JSON.stringify(result.result ?? result.error ?? null, null, 2).slice(0, 1_000); } catch {}
  return { kind: "saved-recipe-candidate", ok: result.ok !== false, sourceCode: result.sourceCode.slice(0, 32_000), capabilities, resultPreview, saveEndpoint: "/api/recipes" };
}

function rawText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? "", null, 2);
  } catch {
    return String(value ?? "");
  }
}

/** Resolve a tool output to exactly one allowlisted renderer. Add future
 * widgets here deliberately; unknown payloads remain inert raw text. */
export function resolveToolResultWidget(value: unknown, toolName = "tool"): ToolResultWidget {
  // The Svelte chat transport does not currently expose the official
  // `agent-tool-event` EventTarget consumed by useAgentToolEvents. Render the
  // retained delegate_many result truthfully as a terminal snapshot; do not
  // imply live progress. Reconnect/history replay re-resolves the same output.
  const delegation = delegationGroupWidget(value, toolName);
  if (delegation) return delegation;

  const svelteArtifact = svelteArtifactWidget(value);
  if (svelteArtifact) return svelteArtifact;

  const browserRun = browserRunWidget(value);
  if (browserRun) return browserRun;

  const rasterArtifact = rasterArtifactWidget(value, toolName);
  if (rasterArtifact) return rasterArtifact;

  const imageSrc = inlineRasterImageSrc(value);
  if (imageSrc) return { kind: "inline-raster-image", src: imageSrc, alt: `${toolName} screenshot` };

  const savedRecipeCandidate = savedRecipeCandidateWidget(value, toolName);
  if (savedRecipeCandidate) return savedRecipeCandidate;

  return { kind: "raw-text", text: rawText(value) };
}

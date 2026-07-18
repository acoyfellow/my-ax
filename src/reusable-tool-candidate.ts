// Reusable-tool candidate policy.
//
// The recipe-audit found that ~92% of promoted snippets were one-off shell
// scrapes named `WorkCodeRecipe_<epoch>` — undiscoverable, unreusable, and
// pushed the auto-trust flywheel into overfit. The fix is to make the *model*
// mark broadly reusable code explicitly, and to keep everything else strictly
// inline.
//
// A work_code run becomes a reusable-tool candidate only when the model opts
// in with an explicit marker comment on the first normalized line:
//
//     // reusable-tool: <meaningful name>
//     async (ctx) => { ... }
//
// Rules (frozen contract):
//   - Marker is REQUIRED. No marker → not eligible; the run is inline-only.
//   - Marker name must be human-meaningful (letter start, >=3 chars after
//     cleanup). This also drives the promoted recipe name — a marker of
//     `disk health check` yields `disk_health_check`, never `snippet_<hash>`
//     and never `WorkCodeRecipe_<epoch>`.
//   - Normalized source must be >=48 characters. Trivial one-liners are
//     never worth a shelf slot.
//   - Suggested recipe shape (name/description/code/inputSchema) must be
//     structurally valid before the model's suggestion is ever persisted.
//   - Fingerprint is a synchronous stable hash over minimally normalized source
//     plus the sorted inferred capability list. Line endings, marker wording,
//     trailing spaces, and trailing semicolons do not change identity; comments
//     and internal JavaScript text remain identity-bearing to avoid collisions.
//
// This module is pure (no Env, no I/O) so both work-tools.ts and agent.ts
// can call it, and both can be tested without a Worker harness.

export type SuggestedRecipeShape = {
  name?: unknown;
  description?: unknown;
  code?: unknown;
  inputSchema?: unknown;
  capabilities?: unknown;
  portable?: unknown;
};

export type ReusableToolCandidate = {
  eligible: boolean;
  fingerprint: string;
  reason:
    | "eligible"
    | "execution_failed"
    | "no_marker"
    | "empty_marker_name"
    | "trivial_source"
    | "invalid_shape"
    | "empty_source"
    | "high_authority_inline_only";
};

export type ReusableToolCandidateInput = {
  executionSucceeded?: boolean;
  sourceCode: string;
  inferredCapabilities: string[];
  suggestedRecipe?: SuggestedRecipeShape;
};

// Minimum normalized source length. Below this a snippet is a one-off command
// (echo, cat, single arithmetic) that has never repaid a shelf slot.
export const REUSABLE_TOOL_MIN_SOURCE_LENGTH = 48;

// The single frozen marker prefix. Kept ASCII-only so paste-through from any
// editor is safe; kept lowercase-first so it reads like a comment, not a
// directive.
// The `[ \t]*` (not `\s*`) inside the pattern is deliberate: `\s` includes `\n`,
// which would let the capture group swallow the *next* line as the marker name
// when the marker line itself is empty after the colon.
const MARKER_PATTERN = /^[\uFEFF \t]*\/\/[ \t]*reusable-tool[ \t]*:[ \t]*([^\r\n]{0,80}?)[ \t]*(?:\r?\n|$)/;

// A "meaningful name" is at least one word-y character after cleanup, and
// the cleanup itself must not collapse it to an empty string.
const MIN_CLEAN_NAME_LENGTH = 3;

/**
 * Normalize source for fingerprinting and length checks without rewriting
 * JavaScript semantics. Remove only the leading reusable-tool marker, then:
 * normalize line endings, trim trailing spaces, collapse excessive blank
 * lines, trim the file, and ignore trailing semicolons. Comments and internal
 * whitespace remain identity-bearing so distinct programs do not collide just
 * because a lossy normalizer made them look alike.
 */
export function normalizeReusableSource(code: string): string {
  if (typeof code !== "string") return "";
  const normalizedLines = code
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(MARKER_PATTERN, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalizedLines.replace(/;+$/g, "").trimEnd();
}

/**
 * Parse the marker comment from raw code and return its cleaned snake_case
 * name, or null when the marker is missing/empty.
 *
 * Returns null (not eligible) when:
 *   - no marker line exists at all
 *   - the marker's name is empty or only punctuation
 *
 * The returned name is the exact name the promotion path should use, so a
 * marker of `disk health check` yields `disk_health_check` and never
 * `WorkCodeRecipe_<epoch>`.
 */
export function parseReusableMarker(code: string): string | null {
  if (typeof code !== "string" || !code) return null;
  const match = code.match(MARKER_PATTERN);
  if (!match) return null;
  const cleaned = cleanMarkerName(match[1] ?? "");
  return cleaned.length >= MIN_CLEAN_NAME_LENGTH ? cleaned : null;
}

function cleanMarkerName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/**
 * Stable synchronous fingerprint over minimally normalized source + sorted
 * inferred capabilities. Synchronous so it composes with executeWorkCode;
 * conservative normalization avoids hiding distinct programs.
 *
 * Uses a plain FNV-1a mix — sufficient to distinguish
 * work_code candidates within an owner's shelf. Not a security primitive.
 */
export function reusableToolFingerprint(code: string, inferredCapabilities: string[]): string {
  const normalized = normalizeReusableSource(code);
  const caps = [...new Set((inferredCapabilities ?? []).map((cap) => String(cap)))].sort();
  const payload = `${normalized}\u0001${caps.join("\u0002")}`;
  // FNV-1a 64-bit implemented with two 32-bit halves so pure JS avoids BigInt.
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x1b873593 >>> 0;
  for (let i = 0; i < payload.length; i++) {
    const c = payload.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (c + 0x9e3779b9) >>> 0;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  const hex = (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 16);
  return `rtc_${hex}`;
}

/**
 * Validate the *shape* of the model's suggestedRecipe payload independently of
 * marker eligibility. This is the last-line contract check before promotion:
 * a suggestion missing name/description/code is never persisted.
 *
 * Note: this does NOT enforce SavedRecipeService's stricter server rules
 * (name pattern, description length, capability format). Those still run at
 * the create() call site so pending-only promotions get the same guardrails
 * every other saved-recipe write does. This is only the "shape is valid enough
 * that we would even try" check.
 */
export function isValidSuggestedShape(shape: SuggestedRecipeShape | undefined): boolean {
  if (!shape || typeof shape !== "object") return false;
  if (typeof shape.name !== "string" || !shape.name.trim()) return false;
  if (typeof shape.description !== "string" || !shape.description.trim()) return false;
  if (typeof shape.code !== "string" || !shape.code.trim()) return false;
  if (!shape.inputSchema || typeof shape.inputSchema !== "object" || Array.isArray(shape.inputSchema)) return false;
  const inputSchema = shape.inputSchema as Record<string, unknown>;
  if (inputSchema.type !== "object") return false;
  return true;
}

/** High-authority host namespaces that can never be persisted as a portable,
 *  replayable reusable tool. Must match recipe-approval-policy.ts. */
const HIGH_AUTHORITY_PREFIXES = ["machine.", "terrarium."] as const;

/** True when a capability set is high-authority AND host-bound (non-portable).
 *  Such code is inline-only: the promotion policy refuses to persist it, so it
 *  must NOT be presented as an approvable reusable-tool candidate. A `.none`
 *  sentinel means "needs no host binding" and does not count as host-bound. */
export function isHighAuthorityInlineOnly(capabilities: string[]): boolean {
  const highAuthority = capabilities.some((cap) => HIGH_AUTHORITY_PREFIXES.some((prefix) => cap.startsWith(prefix)));
  if (!highAuthority) return false;
  const hostBound = capabilities.some((cap) => {
    const [ns, method] = cap.split(".");
    return (ns === "machine" || ns === "terrarium" || ns === "workspace") && method !== "none";
  });
  return hostBound;
}

/**
 * Full candidate evaluation. Returns the fingerprint alongside the eligibility
 * decision so callers can render/store both in a single sync step.
 *
 * eligible=true means every gate passed:
 *   - source is non-empty and normalizes to >= REUSABLE_TOOL_MIN_SOURCE_LENGTH
 *   - marker present with a meaningful cleaned name
 *   - suggested-recipe shape is structurally valid
 *   - the capabilities are NOT high-authority-inline-only (machine/terrarium
 *     host-bound code that the promotion policy will refuse to persist)
 *
 * Any other outcome sets eligible=false with a specific reason so the
 * promotion path can log/skip without guessing.
 *
 * The high-authority gate is the fix for the dogfood bug where an eligible
 * card was shown for a machine-bound tool (e.g. cmux_session_status): the
 * Approve button called by-name/approval, but promotion had refused to persist
 * the row, so getByName never resolved and the button silently reverted to
 * "Enable". Failing closed here means no un-approvable card is ever rendered.
 */
export function evaluateReusableToolCandidate(input: ReusableToolCandidateInput): ReusableToolCandidate {
  const source = typeof input.sourceCode === "string" ? input.sourceCode : "";
  const caps = Array.isArray(input.inferredCapabilities) ? input.inferredCapabilities : [];
  const fingerprint = reusableToolFingerprint(source, caps);
  if (input.executionSucceeded === false) return { eligible: false, fingerprint, reason: "execution_failed" };
  if (!source.trim()) return { eligible: false, fingerprint, reason: "empty_source" };
  const marker = parseReusableMarker(source);
  if (marker === null) {
    // Distinguish "marker missing entirely" from "marker present but empty
    // after cleanup" so guidance and logs can say which happened.
    return { eligible: false, fingerprint, reason: MARKER_PATTERN.test(source) ? "empty_marker_name" : "no_marker" };
  }
  const normalized = normalizeReusableSource(source);
  if (normalized.length < REUSABLE_TOOL_MIN_SOURCE_LENGTH) {
    return { eligible: false, fingerprint, reason: "trivial_source" };
  }
  if (!isValidSuggestedShape(input.suggestedRecipe)) {
    return { eligible: false, fingerprint, reason: "invalid_shape" };
  }
  // Fail closed: host-bound machine/terrarium code is inline-only and cannot be
  // persisted, so it must not surface an approvable candidate card.
  if (isHighAuthorityInlineOnly(caps)) {
    return { eligible: false, fingerprint, reason: "high_authority_inline_only" };
  }
  return { eligible: true, fingerprint, reason: "eligible" };
}

/**
 * Recipe name to promote to. When a marker is present its cleaned form wins,
 * otherwise the caller's fallback is used unchanged. Keeping this pure lets
 * work-tools.ts pipe it into suggestRecipeName without introducing a circular
 * dep.
 */
export function reusableToolNameFromMarker(code: string, fallback: string): string {
  const marker = parseReusableMarker(code);
  return marker ?? fallback;
}

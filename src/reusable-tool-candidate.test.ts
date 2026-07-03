import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReusableToolCandidate,
  isValidSuggestedShape,
  normalizeReusableSource,
  parseReusableMarker,
  reusableToolFingerprint,
  reusableToolNameFromMarker,
  REUSABLE_TOOL_MIN_SOURCE_LENGTH,
  type SuggestedRecipeShape,
} from "./reusable-tool-candidate";

const validShape: SuggestedRecipeShape = {
  name: "disk_health_check",
  description: "Report disk health for the workspace.",
  code: "// reusable-tool: disk health check\nasync (ctx) => ({ ok: true })",
  inputSchema: { type: "object", properties: {} },
  capabilities: ["workspace.read"],
  portable: false,
};

const nonTrivialCode = `// reusable-tool: disk health check
async (ctx) => {
  const files = await ctx.workspace.list({ path: "/home/user" });
  return { count: files.length };
}`;

// ---------------------------------------------------------------------------
// Marker parsing / naming
// ---------------------------------------------------------------------------

test("parseReusableMarker returns null when the marker is missing entirely", () => {
  assert.equal(parseReusableMarker("async (ctx) => ({ ok: true })"), null);
  assert.equal(parseReusableMarker(""), null);
});

test("parseReusableMarker returns null when the marker name is empty or punctuation-only", () => {
  assert.equal(parseReusableMarker("// reusable-tool: \nasync () => ({})"), null);
  assert.equal(parseReusableMarker("// reusable-tool: !!!\nasync () => ({})"), null);
});

test("parseReusableMarker returns the cleaned snake_case name", () => {
  assert.equal(parseReusableMarker("// reusable-tool: Disk Health Check\nasync () => ({})"), "disk_health_check");
  assert.equal(parseReusableMarker("//reusable-tool:disk-health-check\nasync () => ({})"), "disk_health_check");
});

test("reusableToolNameFromMarker prefers the marker name over the heuristic fallback", () => {
  assert.equal(reusableToolNameFromMarker("// reusable-tool: fetch weather\nasync () => ({})", "compute_x"), "fetch_weather");
  assert.equal(reusableToolNameFromMarker("async () => ({})", "compute_x"), "compute_x");
});

// ---------------------------------------------------------------------------
// Normalization + fingerprint stability
// ---------------------------------------------------------------------------

test("normalizeReusableSource strips comments and collapses whitespace", () => {
  const raw = "// reusable-tool: fx\n/* block */ async  (ctx)   =>\n  ({ ok: true }) // trailing";
  assert.equal(normalizeReusableSource(raw), "async (ctx) => ({ ok: true })");
});

test("normalizeReusableSource preserves URLs in string literals (does not strip //)", () => {
  const raw = 'async () => fetch("https://example.com")';
  assert.match(normalizeReusableSource(raw), /https:\/\/example\.com/);
});

test("reusableToolFingerprint is stable across whitespace/comment noise", () => {
  const a = "// reusable-tool: fx\nasync (ctx) => { return await ctx.workspace.list({ path: '/x' }); }";
  const b = "//   reusable-tool:  fx  \n\nasync   (ctx)   =>   {   return await ctx.workspace.list({ path: '/x' });   }";
  assert.equal(reusableToolFingerprint(a, ["workspace.list"]), reusableToolFingerprint(b, ["workspace.list"]));
});

test("reusableToolFingerprint is sensitive to inferred capabilities", () => {
  const code = "// reusable-tool: fx\nasync (ctx) => { return 1; }";
  const one = reusableToolFingerprint(code, ["workspace.read"]);
  const two = reusableToolFingerprint(code, ["machine.shell"]);
  assert.notEqual(one, two);
});

test("reusableToolFingerprint sorts capabilities before hashing", () => {
  const code = "// reusable-tool: fx\nasync () => 1";
  const a = reusableToolFingerprint(code, ["workspace.read", "machine.shell"]);
  const b = reusableToolFingerprint(code, ["machine.shell", "workspace.read"]);
  assert.equal(a, b);
});

test("reusableToolFingerprint carries the rtc_ prefix and a fixed-length hex tail", () => {
  const fp = reusableToolFingerprint("// reusable-tool: fx\nasync () => 1", []);
  assert.match(fp, /^rtc_[0-9a-f]{16}$/);
});

// ---------------------------------------------------------------------------
// Suggested shape validation
// ---------------------------------------------------------------------------

test("isValidSuggestedShape rejects missing / non-string fields and non-object inputSchema", () => {
  assert.equal(isValidSuggestedShape(undefined), false);
  assert.equal(isValidSuggestedShape({} as SuggestedRecipeShape), false);
  assert.equal(isValidSuggestedShape({ ...validShape, name: "" }), false);
  assert.equal(isValidSuggestedShape({ ...validShape, description: "" }), false);
  assert.equal(isValidSuggestedShape({ ...validShape, code: "" }), false);
  assert.equal(isValidSuggestedShape({ ...validShape, inputSchema: null as unknown as SuggestedRecipeShape["inputSchema"] }), false);
  assert.equal(isValidSuggestedShape({ ...validShape, inputSchema: [] }), false);
  assert.equal(isValidSuggestedShape({ ...validShape, inputSchema: { type: "string" } }), false);
});

test("isValidSuggestedShape accepts a well-formed suggestion", () => {
  assert.equal(isValidSuggestedShape(validShape), true);
});

// ---------------------------------------------------------------------------
// Full eligibility gate
// ---------------------------------------------------------------------------

test("evaluateReusableToolCandidate: no marker => not eligible (no_marker)", () => {
  const decision = evaluateReusableToolCandidate({
    sourceCode: "async (ctx) => ctx.machine.shell({ command: 'ls' })",
    inferredCapabilities: ["machine.shell"],
    suggestedRecipe: validShape,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "no_marker");
  assert.match(decision.fingerprint, /^rtc_/);
});

test("evaluateReusableToolCandidate: empty marker name => not eligible (empty_marker_name)", () => {
  const decision = evaluateReusableToolCandidate({
    sourceCode: "// reusable-tool:   \nasync (ctx) => { return await ctx.workspace.list({ path: '/home/user' }); }",
    inferredCapabilities: ["workspace.list"],
    suggestedRecipe: validShape,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "empty_marker_name");
});

test("evaluateReusableToolCandidate: trivial source (<48 chars) => not eligible (trivial_source)", () => {
  const short = "// reusable-tool: quick tool\nasync () => 1";
  assert.ok(normalizeReusableSource(short).length < REUSABLE_TOOL_MIN_SOURCE_LENGTH);
  const decision = evaluateReusableToolCandidate({
    sourceCode: short,
    inferredCapabilities: [],
    suggestedRecipe: validShape,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "trivial_source");
});

test("evaluateReusableToolCandidate: invalid shape => not eligible (invalid_shape)", () => {
  const decision = evaluateReusableToolCandidate({
    sourceCode: nonTrivialCode,
    inferredCapabilities: ["workspace.list"],
    suggestedRecipe: { name: "", description: "", code: "", inputSchema: { type: "object", properties: {} } },
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "invalid_shape");
});

test("evaluateReusableToolCandidate: empty source => not eligible (empty_source)", () => {
  const decision = evaluateReusableToolCandidate({
    sourceCode: "",
    inferredCapabilities: [],
    suggestedRecipe: validShape,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "empty_source");
});

test("evaluateReusableToolCandidate: marker + non-trivial source + valid shape => eligible", () => {
  const decision = evaluateReusableToolCandidate({
    sourceCode: nonTrivialCode,
    inferredCapabilities: ["workspace.list"],
    suggestedRecipe: validShape,
  });
  assert.equal(decision.eligible, true);
  assert.equal(decision.reason, "eligible");
  assert.match(decision.fingerprint, /^rtc_/);
});

test("evaluateReusableToolCandidate: fingerprint is present even when ineligible", () => {
  const decision = evaluateReusableToolCandidate({
    sourceCode: "async () => 1",
    inferredCapabilities: [],
    suggestedRecipe: undefined,
  });
  assert.match(decision.fingerprint, /^rtc_/);
  assert.equal(decision.eligible, false);
});

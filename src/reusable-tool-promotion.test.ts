// Contract tests for the agent.ts promoteSuggestedRecipe frozen behaviour.
//
// The promotion loop cannot be executed in a unit test without spinning up a
// Think agent + D1 + all of the Workers-only bindings. But every rule in the
// frozen contract is a structural invariant that a static read of the source
// can verify: the guards MUST appear in the promotion path, the notification
// MUST render the Settings href, and the loop MUST catch SavedRecipeError
// Conflict per-iteration so a duplicate cannot short-circuit later candidates.
//
// Complementary tests:
//   - reusable-tool-candidate.test.ts covers the pure eligibility policy.
//   - work-tools-recipes.test.ts covers work_code's namespace surface guards.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const agent = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");
const workTools = readFileSync(new URL("./work-tools.ts", import.meta.url), "utf8");

function promotionSlice(src: string): string {
  const start = src.indexOf("private async promoteSuggestedRecipe(");
  assert.ok(start >= 0, "promoteSuggestedRecipe must exist in agent.ts");
  // Grab a generous window; the function is a few dozen lines.
  return src.slice(start, start + 10000);
}

// ---------------------------------------------------------------------------
// Only work_code outputs are eligible
// ---------------------------------------------------------------------------

test("promotion loop scopes candidates to work_code tool outputs only", () => {
  const slice = promotionSlice(agent);
  assert.match(
    slice,
    /candidate\.type === "tool-work_code"|toolName === "work_code"/,
    "promotion must gate on the work_code tool identity, not any suggestedRecipe-shaped output",
  );
});

// ---------------------------------------------------------------------------
// Marker eligibility gate
// ---------------------------------------------------------------------------

test("promotion loop only persists candidates whose reusableToolCandidate.eligible is true", () => {
  const slice = promotionSlice(agent);
  assert.match(slice, /reusableToolCandidate/, "promotion must read the reusableToolCandidate field");
  assert.match(slice, /!candidate\.eligible|candidate\.eligible === false/, "promotion must skip when eligible is false");
});

// ---------------------------------------------------------------------------
// Pending-only status
// ---------------------------------------------------------------------------

test("promotion loop forces every eligible candidate to pending regardless of legacy RECIPE_AUTOTRUST", () => {
  const slice = promotionSlice(agent);
  // A literal "pending" status must be assigned into the create() call, not
  // routed through initialStatusForPromotion, so the frozen contract can't
  // regress when an owner sets RECIPE_AUTOTRUST=1.
  assert.match(slice, /status:\s*"pending"/, "promotion must assign pending status literally");
  // Belt-and-braces: ensure initialStatusForPromotion is not the source of
  // the status field for marker-eligible candidates.
  assert.doesNotMatch(
    slice.slice(0, slice.indexOf("status: \"pending\"") + 24),
    /initialStatusForPromotion\(this\.env\)\s*;\s*[^]*?status:\s*status/,
    "marker path must not derive status from initialStatusForPromotion",
  );
});

// ---------------------------------------------------------------------------
// High-authority inline-only preservation
// ---------------------------------------------------------------------------

test("promotion loop keeps the high-authority inline-only decision (recipeApprovalDecision) intact", () => {
  const slice = promotionSlice(agent);
  assert.match(slice, /recipeApprovalDecision\(/);
  assert.match(slice, /shouldPersistSuggestedRecipe\(decision\)/);
});

// ---------------------------------------------------------------------------
// Owner notification uses the Settings deep-link href
// ---------------------------------------------------------------------------

test("owner notification renders the Reusable tools Settings deep-link, not the legacy API approval URL", () => {
  const slice = promotionSlice(agent);
  assert.match(slice, /href:\s*`\/\?action=settings&section=recipes&recipe=\$\{encodeURIComponent\(recipe\.name\)\}`/, "must use the rendered Settings review deep-link");
  assert.match(slice, /Review reusable tool:/, "owner-visible notification must use Reusable tool language");
  assert.doesNotMatch(slice, /\/api\/recipes\/\$\{encodeURIComponent\(recipe\.id\)\}\/approval/, "legacy approval URL must be gone");
});

// ---------------------------------------------------------------------------
// SavedRecipeError Conflict is fail-soft per iteration
// ---------------------------------------------------------------------------

test("promotion loop catches SavedRecipeError inside each iteration so a duplicate does not abort later candidates", () => {
  const slice = promotionSlice(agent);
  assert.match(slice, /try\s*\{[\s\S]*?SavedRecipeService[\s\S]*?\.create\(/, "create must be inside a try");
  assert.match(slice, /catch\s*\(\s*error\s*\)\s*\{[\s\S]*?SavedRecipeError[\s\S]*?continue/, "SavedRecipeError must continue to the next iteration");
});

// ---------------------------------------------------------------------------
// Legacy auto-trust helpers still intact (frozen: don't delete)
// ---------------------------------------------------------------------------

test("legacy auto-trust mode remains observable without controlling candidate status", () => {
  assert.match(agent, /import \{ autoTrustMode \} from "\.\/auto-trust"/, "auto-trust mode remains available for receipt compatibility");
  assert.match(agent, /autoTrustMode\(this\.env\)/, "autoTrustMode must still be read (receipt shape stability)");
});

// ---------------------------------------------------------------------------
// work_code surface: reusableToolCandidate is now on the response, marker
// guidance is in the tool description, and public system prompt teaches the
// marker semantics.
// ---------------------------------------------------------------------------

test("executeWorkCode now returns a reusableToolCandidate alongside suggestedRecipe (compat preserved)", () => {
  assert.match(workTools, /suggestedRecipe,/, "suggestedRecipe compatibility field must remain");
  assert.match(workTools, /reusableToolCandidate,/, "reusableToolCandidate must be added");
  assert.match(workTools, /evaluateReusableToolCandidate\(/);
  assert.match(workTools, /reusableToolNameFromMarker\(code,/, "marker name must win over the fallback heuristic");
});

test("work_code tool description explains the marker semantics and its narrow scope", () => {
  const desc = workTools.match(/WORK_CODE_TOOL[\s\S]*?description:\s*"([^"]+)"/);
  assert.ok(desc, "work_code description literal must be present");
  assert.match(desc![1], /reusable-tool:/, "description must document the marker prefix");
  assert.match(desc![1], /broadly reusable/, "description must explain the marker is for broadly reusable code");
  assert.match(desc![1], /one-off|Never add the marker/, "description must warn against marking one-off commands");
});

test("public agent system prompt teaches the marker semantics", () => {
  const promptSlice = agent.slice(agent.indexOf("PUBLIC_SYSTEM"), agent.indexOf("PUBLIC_SYSTEM") + 5000);
  assert.match(promptSlice, /reusable-tool:/, "system prompt must show the marker prefix");
  assert.match(promptSlice, /broadly reusable/, "system prompt must explain the marker is for broadly reusable code");
  assert.match(promptSlice, /Settings\s*→\s*Reusable tools|Settings.*Reusable tools/, "system prompt should use the owner-facing Reusable tools destination");
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const routes = readFileSync(new URL("./routes/recipes.ts", import.meta.url), "utf8");

function directApprovalSlice() {
  const start = routes.indexOf('app.post("/api/recipes/by-name/approval"');
  assert.ok(start >= 0, "direct chat approval route must exist");
  return routes.slice(start, start + 2200);
}

test("direct chat approval is owner-scoped and source-bound", () => {
  const slice = directApprovalSlice();
  assert.match(slice, /service\(c\)\.getByName\(name\)/, "lookup must use the identity-scoped service");
  assert.match(slice, /attempt < 10/, "immediate card clicks must bridge the end-of-turn persistence race");
  assert.match(slice, /existing\.code\.trim\(\) !== sourceCode/, "stale or conflicting cards must not approve different code");
  assert.match(slice, /status: action === "approve" \? "enabled" : "disabled"/);
  assert.match(slice, /projectSavedRecipe\(/, "approved tools must enter Code Mode immediately");
});

test("approval preference endpoints use the authenticated identity", () => {
  assert.match(routes, /reusableToolApprovalMode\(c\.env, c\.get\("identity"\)\.email\)/);
  assert.match(routes, /setReusableToolApprovalMode\(c\.env, c\.get\("identity"\)\.email, request\.approvalMode\)/);
});

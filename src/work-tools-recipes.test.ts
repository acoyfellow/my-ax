import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./work-tools.ts", import.meta.url), "utf8");
const agent = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");

test("work_code exposes owner-approved saved recipes as a small recipe namespace", () => {
  assert.match(source, /recipe\.list\(\)/);
  assert.match(source, /recipe\.run\(\{id\|name,input\}\)/);
  assert.match(source, /ctx\.listSavedRecipes/);
  assert.match(source, /ctx\.runSavedRecipe/);
  assert.match(source, /namespace\("recipe", Object\.keys\(recipeFns\)\)/);
  assert.match(source, /method: `recipe\.run:\$\{recipe\.name\}`/);
  assert.match(agent, /listSavedRecipes: async \(\) =>/);
  assert.match(agent, /runSavedRecipe: async \(input\) =>/);
});

test("saved recipe execution enforces declared capabilities and disables nested recipe calls", () => {
  assert.match(source, /function restrictByCapabilities/);
  assert.match(source, /allowedWorkCapabilities/);
  assert.match(source, /capability not granted/);
  assert.match(source, /ctx\.exposeSavedRecipes !== false/);
  assert.match(agent, /allowedWorkCapabilities: JSON\.parse\(recipe\.capabilities_json\)/);
  assert.match(agent, /exposeSavedRecipes: false/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { getPantryRecipe, listPantryRecipes, pantryConfig, pantryRecipeExecutionCode } from "./pantry-client";
import type { Env } from "./types";

test("pantryConfig defaults to the public pantry host", () => {
  const config = pantryConfig({} as Env);
  assert.equal(config.url, "https://pantry.coey.dev");
  assert.equal(config.token, undefined);
});

test("listPantryRecipes returns empty when PANTRY_TOKEN is unset", async () => {
  const recipes = await listPantryRecipes({} as Env);
  assert.deepEqual(recipes, []);
});

test("listPantryRecipes uses the PANTRY service bind when present", async () => {
  const env = {
    PANTRY_TOKEN: "agent",
    PANTRY: {
      fetch: async (input: RequestInfo | URL) => {
        const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        assert.match(href, /\/recipes$/);
        return new Response(JSON.stringify({
          recipes: [{ name: "review_this_mr", description: "Audit one MR.", capabilities: ["workspace.none"], status: "enabled", version: 4 }],
        }), { status: 200 });
      },
    },
  } as unknown as Env;
  const recipes = await listPantryRecipes(env);
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0]?.name, "review_this_mr");
  assert.equal(recipes[0]?.source, "pantry");
});

test("getPantryRecipe returns code for an enabled recipe", async () => {
  const env = {
    PANTRY_TOKEN: "agent",
    PANTRY: {
      fetch: async () => new Response(JSON.stringify({
        name: "review_this_mr",
        description: "Audit one MR.",
        inputSchema: { type: "object", properties: {} },
        code: "return { ok: true };",
        capabilities: ["workspace.none"],
        status: "enabled",
        version: 4,
      }), { status: 200 }),
    },
  } as unknown as Env;
  const recipe = await getPantryRecipe(env, "review_this_mr");
  assert.equal(recipe?.code, "return { ok: true };");
});

test("pantryRecipeExecutionCode exposes ctx.input to pantry bodies", () => {
  const code = pantryRecipeExecutionCode("return ctx.input.n;");
  assert.match(code, /async \(input\) =>/);
  assert.match(code, /const ctx = \{ input \}/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { validateRecipeRunInput, validateSavedRecipeInput, validateSavedRecipePatch } from "./saved-recipes";

test("saved recipe validation keeps promoted work_code bounded and explicit", () => {
  const recipe = validateSavedRecipeInput({
    name: "check_blog",
    description: "Check the local blog build output.",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
    code: "return await workspace.read({ path: input.path });",
    capabilities: ["workspace.read", "workspace.read"],
    sourceRunId: "run-1",
  });
  assert.equal(recipe.name, "check_blog");
  assert.deepEqual(recipe.capabilities, ["workspace.read"]);
  assert.equal(recipe.status, "enabled");
  assert.equal(recipe.sourceRunId, "run-1");
});

test("saved recipe validation rejects generic extension-shaped power", () => {
  assert.throws(() => validateSavedRecipeInput({ name: "bad-name", description: "Bad recipe", inputSchema: { type: "object" }, code: "return 1", capabilities: ["workspace.read"] }), /name must match/);
  assert.throws(() => validateSavedRecipeInput({ name: "net", description: "Network", inputSchema: { type: "object" }, code: "return fetch('https://example.com')", capabilities: ["network.fetch"] }), /invalid capabilities/);
  assert.throws(() => validateSavedRecipeInput({ name: "secret", description: "Secret", inputSchema: { type: "object" }, code: "return env.SECRET", capabilities: [] }), /capabilities must list/);
});

test("saved recipe run input enforces the declared object schema subset", () => {
  const schema = { type: "object", required: ["path"], properties: { path: { type: "string", minLength: 2 }, retries: { type: "number", minimum: 0, maximum: 3 } } };
  assert.deepEqual(validateRecipeRunInput({ path: "/x", retries: 1 }, schema), { path: "/x", retries: 1 });
  assert.throws(() => validateRecipeRunInput({}, schema), /input\.path is required/);
  assert.throws(() => validateRecipeRunInput({ path: 1 }, schema), /input\.path must be string/);
  assert.throws(() => validateRecipeRunInput({ path: "/x", retries: 9 }, schema), /input\.retries must be <= 3/);
});

test("saved recipe patch supports focused CRUD edits", () => {
  assert.deepEqual(validateSavedRecipePatch({ status: "disabled" }), { status: "disabled" });
  assert.deepEqual(validateSavedRecipePatch({ description: "Updated useful recipe.", capabilities: ["workspace.read", "workspace.write"] }), {
    description: "Updated useful recipe.",
    capabilities: ["workspace.read", "workspace.write"],
  });
  assert.throws(() => validateSavedRecipePatch({}), /at least one field/);
  assert.throws(() => validateSavedRecipePatch({ status: "archived" }), /status must be pending, enabled, or disabled/);
});

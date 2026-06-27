import assert from "node:assert/strict";
import test from "node:test";
import { validateSavedHammerInput, validateSavedHammerPatch } from "./saved-hammers";

test("saved hammer validation keeps promoted work_code bounded and explicit", () => {
  const hammer = validateSavedHammerInput({
    name: "check_blog",
    description: "Check the local blog build output.",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
    code: "return await workspace.read({ path: input.path });",
    capabilities: ["workspace.read", "workspace.read"],
    sourceRunId: "run-1",
  });
  assert.equal(hammer.name, "check_blog");
  assert.deepEqual(hammer.capabilities, ["workspace.read"]);
  assert.equal(hammer.status, "enabled");
  assert.equal(hammer.sourceRunId, "run-1");
});

test("saved hammer validation rejects generic extension-shaped power", () => {
  assert.throws(() => validateSavedHammerInput({ name: "bad-name", description: "Bad hammer", inputSchema: { type: "object" }, code: "return 1", capabilities: ["workspace.read"] }), /name must match/);
  assert.throws(() => validateSavedHammerInput({ name: "net", description: "Network", inputSchema: { type: "object" }, code: "return fetch('https://example.com')", capabilities: ["network.fetch"] }), /invalid capabilities/);
  assert.throws(() => validateSavedHammerInput({ name: "secret", description: "Secret", inputSchema: { type: "object" }, code: "return env.SECRET", capabilities: [] }), /capabilities must list/);
});

test("saved hammer patch supports focused CRUD edits", () => {
  assert.deepEqual(validateSavedHammerPatch({ status: "disabled" }), { status: "disabled" });
  assert.deepEqual(validateSavedHammerPatch({ description: "Updated useful recipe.", capabilities: ["workspace.read", "workspace.write"] }), {
    description: "Updated useful recipe.",
    capabilities: ["workspace.read", "workspace.write"],
  });
  assert.throws(() => validateSavedHammerPatch({}), /at least one field/);
  assert.throws(() => validateSavedHammerPatch({ status: "archived" }), /status must be enabled or disabled/);
});

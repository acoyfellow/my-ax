import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_MODEL_ID, MODELS, findModel, resolveModelId } from "./models";

describe("model catalog", () => {
  it("contains only usable Workers AI rows", () => {
    assert.ok(MODELS.length > 1);
    for (const model of MODELS) {
      assert.equal(model.route, "workers-ai");
      assert.equal(model.id.startsWith("@cf/"), true, model.id);
      assert.equal(/alpha/i.test(`${model.id} ${model.label}`), false, model.id);
      assert.equal(model.tools, true, model.id);
    }
  });

  it("uses a visible default and heals removed ids", () => {
    assert.ok(findModel(DEFAULT_MODEL_ID));
    assert.equal(resolveModelId(undefined), DEFAULT_MODEL_ID);
    assert.equal(resolveModelId("kindle-alpha-api"), DEFAULT_MODEL_ID);
    assert.equal(resolveModelId("mercury-alpha"), DEFAULT_MODEL_ID);
    assert.equal(resolveModelId("gpt-5.5"), DEFAULT_MODEL_ID);
  });
});

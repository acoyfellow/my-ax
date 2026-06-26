import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_MODEL_ID, MODELS, findModel, resolveModelId } from "./models";

describe("model catalog", () => {
  it("keeps Workers AI and AI Gateway rows visible", () => {
    assert.ok(findModel("@cf/moonshotai/kimi-k2.7-code"));
    assert.ok(findModel("@cf/zai-org/glm-5.2"));
    assert.equal(findModel("gpt-5.5")?.route, "gateway-openai");
    assert.equal(findModel("claude-opus-4-8")?.route, "gateway-anthropic");
    for (const model of MODELS) assert.equal(model.tools, true, model.id);
  });

  it("removes alpha rows while healing stale alpha ids", () => {
    for (const model of MODELS) assert.equal(/alpha/i.test(`${model.id} ${model.label}`), false, model.id);
    assert.equal(resolveModelId("kindle-alpha-api"), DEFAULT_MODEL_ID);
    assert.equal(resolveModelId("mercury-alpha"), DEFAULT_MODEL_ID);
  });

  it("uses a visible default and preserves valid gateway ids", () => {
    assert.ok(findModel(DEFAULT_MODEL_ID));
    assert.equal(resolveModelId(undefined), DEFAULT_MODEL_ID);
    assert.equal(resolveModelId("gpt-5.5"), "gpt-5.5");
    assert.equal(resolveModelId("claude-opus-4-8"), "claude-opus-4-8");
  });
});

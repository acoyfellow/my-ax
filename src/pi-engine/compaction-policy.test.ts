import assert from "node:assert/strict";
import { test } from "node:test";
import { compactsAt, piCompactionSettings, summaryBudget, LARGE_WINDOW_COMPACT_AT_TOKENS, SUMMARY_MAX_TOKENS } from "./compaction-policy";
import { gatewayModelWindows } from "./gateway-models";

test("every 1M gateway model compacts at 150K tokens with a summary near 8K, starting in the background 30K earlier", () => {
  const settings = piCompactionSettings(gatewayModelWindows());
  const keys = Object.keys(settings.modelOverrides ?? {});
  assert.deepEqual(keys.sort(), ["myax-gateway/claude-opus-5", "myax-gateway/claude-opus-5-5", "myax-gateway/claude-sonnet-5-5"]);
  for (const key of keys) {
    const policy = settings.modelOverrides![key]!;
    assert.equal(1_000_000 - policy.reserveTokens!, LARGE_WINDOW_COMPACT_AT_TOKENS);
    assert.equal(policy.keepRecentTokens, 30_000);
    assert.equal(policy.backgroundTokens, 30_000);
  }
  assert.equal(compactsAt(1_000_000), 150_000);
});

test("the summary budget is the harness's 80% of reserve, capped by the model's own output limit", () => {
  assert.ok(summaryBudget(1_000_000) >= SUMMARY_MAX_TOKENS);
  assert.equal(Math.min(summaryBudget(1_000_000), 128_000), 128_000);
});

test("small-window models keep the harness defaults", () => {
  const settings = piCompactionSettings([{ provider: "workers-ai", id: "small", contextWindow: 131_072 }]);
  assert.deepEqual(settings.modelOverrides, {});
  assert.equal(settings.reserveTokens, 16_384);
});

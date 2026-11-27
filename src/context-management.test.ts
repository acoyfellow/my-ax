import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@earendil-works/pi-ai";
import { buildContextSnapshot, compactionSettingsWithOverride, defaultContextPolicy, estimateTokens, sanitizeContextPolicy, type ContextViewInput } from "./context-management";
import { defaultAgentSettings, hasAgentOverrides, sanitizeAgentSettings } from "./agent-settings";

const BIG = [{ provider: "p", id: "big", contextWindow: 1_000_000 }];
const SMALL = [{ provider: "p", id: "small", contextWindow: 200_000 }];

const user = (text: string): Message => ({ role: "user", content: text, timestamp: 0 });
const assistant = (text: string): Message => ({ role: "assistant", content: [{ type: "text", text }] }) as unknown as Message;
const toolResult = (text: string): Message => ({ role: "toolResult", toolCallId: "1", toolName: "exec", content: [{ type: "text", text }], isError: false, timestamp: 0 }) as unknown as Message;

test("estimateTokens is a quarter of the length, rounded up", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcde"), 2);
});

test("sanitizeContextPolicy clamps numbers and trims notes", () => {
  assert.deepEqual(sanitizeContextPolicy(undefined), defaultContextPolicy());
  const policy = sanitizeContextPolicy({ autoCompact: false, compactAtTokens: 5, keepRecentTokens: 9_999_999, preserveFirstMessage: "yes", compactionNotes: "  keep paths  " });
  assert.equal(policy.autoCompact, false);
  assert.equal(policy.compactAtTokens, 16_000);
  assert.equal(policy.keepRecentTokens, 120_000);
  assert.equal(policy.preserveFirstMessage, null);
  assert.equal(policy.compactionNotes, "keep paths");
  assert.equal(sanitizeContextPolicy({ compactionNotes: "x".repeat(1501) }).compactionNotes, null);
  assert.equal(sanitizeContextPolicy({ compactAtTokens: 2_000_000 }).compactAtTokens, 900_000);
});

test("compactionSettingsWithOverride inherits defaults and applies overrides", () => {
  const inherited = compactionSettingsWithOverride(BIG, defaultContextPolicy());
  assert.equal(inherited.enabled, true);
  assert.equal(inherited.modelOverrides?.["p/big"]?.reserveTokens, 750_000);

  const off = compactionSettingsWithOverride(BIG, { ...defaultContextPolicy(), autoCompact: false });
  assert.equal(off.enabled, false);

  const custom = compactionSettingsWithOverride([...BIG, ...SMALL], { ...defaultContextPolicy(), compactAtTokens: 128_000, keepRecentTokens: 60_000 });
  assert.equal(custom.keepRecentTokens, 60_000);
  assert.equal(custom.modelOverrides?.["p/big"]?.reserveTokens, 872_000);
  assert.equal(custom.modelOverrides?.["p/big"]?.keepRecentTokens, 60_000);
  assert.equal(custom.modelOverrides?.["p/small"]?.reserveTokens, 72_000);
});

function viewWithSummary(): ContextViewInput {
  const contributions = [[user("S".repeat(400))], [user("u".repeat(40))], [assistant("a".repeat(80))], [toolResult("t".repeat(4000))], [user("short")], [assistant("b".repeat(200))], [toolResult("c".repeat(800))]];
  return {
    head: { id: 1, kind: "pi.compaction" },
    entries: [{ id: 1, kind: "pi.compaction" }, { id: 2, kind: "pi.user" }, { id: 3, kind: "pi.assistant" }, { id: 4, kind: "pi.tool-result" }, { id: 5, kind: "pi.user" }, { id: 6, kind: "pi.assistant" }, { id: 7, kind: "pi.tool-result" }],
    contributions,
    messages: contributions.flat(),
  };
}

test("buildContextSnapshot computes buckets, percent, top entries and head summary", () => {
  const snapshot = buildContextSnapshot({ model: "big", contextWindow: 1_000_000, policy: defaultContextPolicy(), contextView: viewWithSummary(), totalEntries: 20, compactionCount: 2, compacting: false });
  assert.deepEqual(snapshot.buckets, { summary: 100, user: 12, assistant: 70, tools: 1200 });
  assert.equal(snapshot.activeTokens, 1382);
  assert.equal(snapshot.compactAtTokens, 250_000);
  assert.equal(snapshot.percentOfCompact, 1);
  assert.equal(snapshot.topEntries.length, 5);
  assert.deepEqual(snapshot.topEntries.map((entry) => entry.id), [4, 7, 1, 6, 3]);
  assert.equal(snapshot.topEntries[0]?.label, "Tool · exec");
  assert.equal(snapshot.topEntries[2]?.label, "Summary");
  assert.ok((snapshot.topEntries[0]?.preview.length ?? 0) <= 90);
  assert.equal(snapshot.headSummary?.entryId, 1);
  assert.equal(snapshot.headSummary?.tokens, 100);
  assert.equal(snapshot.activeEntryCount, 7);
  assert.equal(snapshot.totalEntryCount, 20);
  assert.equal(snapshot.compactionCount, 2);
  assert.equal(snapshot.effectivePolicy.keepRecentTokens, 30_000);
  assert.equal(snapshot.effectivePolicy.preserveFirstMessage, true);
});

test("buildContextSnapshot caps percent at 100 and has no summary without a compaction head", () => {
  const messages = [user("x".repeat(80_000))];
  const view: ContextViewInput = { head: undefined, entries: [{ id: 1, kind: "pi.user" }], contributions: [messages], messages };
  const snapshot = buildContextSnapshot({ model: "small", contextWindow: 200_000, policy: { ...defaultContextPolicy(), compactAtTokens: 16_000 }, contextView: view, totalEntries: 1, compactionCount: 0, compacting: true });
  assert.equal(snapshot.percentOfCompact, 100);
  assert.equal(snapshot.headSummary, null);
  assert.equal(snapshot.compacting, true);
});

test("AgentSettings round-trips the context policy", () => {
  assert.equal(hasAgentOverrides(defaultAgentSettings()), false);
  const settings = sanitizeAgentSettings({ context: { autoCompact: false, compactAtTokens: 128_000, compactionNotes: "keep paths" } });
  assert.equal(hasAgentOverrides(settings), true);
  assert.deepEqual(sanitizeAgentSettings(JSON.parse(JSON.stringify(settings))), settings);
  assert.deepEqual(sanitizeAgentSettings({}).context, defaultContextPolicy());
});

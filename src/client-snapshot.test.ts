import assert from "node:assert/strict";
import test from "node:test";
import { formatClientSnapshot, parseInputChannel, requireInputChannel, snapshotTokenBudget } from "./client-snapshot";

test("missing channel fails loud and does not default to text", () => {
  assert.equal(parseInputChannel("hello"), "unknown");
  assert.throws(() => requireInputChannel("hello"), /INPUT_CHANNEL_MISSING/);
  assert.equal(requireInputChannel("VOICE_CHANNEL=audio. User said: hi"), "voice");
  assert.equal(requireInputChannel("INPUT_CHANNEL=text. hello"), "text");
});

test("snapshot stays under 200 tokens and never fabricates missing fields", () => {
  const text = formatClientSnapshot({
    channel: { value: "voice", at: "t1" },
    device: { value: "unknown", at: "t1" },
    version: { value: "644da8e4 fresh", at: "t1" },
    geo: { value: "coarse low-confidence unknown", at: "t1", stale: true },
  });
  assert.match(text, /device: unknown/);
  assert.match(text, /geo: .* stale/);
  assert.equal(snapshotTokenBudget(text, 200).ok, true);
  assert.doesNotMatch(text, /readHealth/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { annotateTurnDurations, formatTurnDuration, type TimedMessage } from "./turn-duration";

test("durations format as seconds, minutes and hours", () => {
  assert.equal(formatTurnDuration(4_200), "4s");
  assert.equal(formatTurnDuration(105_000), "1m 45s");
  assert.equal(formatTurnDuration(3_725_000), "1h 2m");
});

test("each finished turn gets a duration on its last agent message", () => {
  const messages = annotateTurnDurations<TimedMessage>([
    { role: "user", timestamp: 1_000 },
    { role: "assistant", timestamp: 2_000 },
    { role: "assistant", timestamp: 3_000, endedAt: 106_000 },
    { role: "user", timestamp: 200_000 },
    { role: "assistant", timestamp: 204_000 },
  ]);
  assert.equal(messages[1]!.durationMs, undefined);
  assert.equal(messages[2]!.durationMs, 105_000);
  assert.equal(messages[4]!.durationMs, 4_000);
});

test("a turn still streaming has no duration yet", () => {
  const messages = annotateTurnDurations<TimedMessage>([
    { role: "user", timestamp: 1_000 },
    { role: "assistant", timestamp: 2_000, streaming: true },
  ]);
  assert.equal(messages[1]!.durationMs, undefined);
});

test("a turn without timestamps gets no duration", () => {
  const messages = annotateTurnDurations<TimedMessage>([{ role: "user" }, { role: "assistant" }]);
  assert.equal(messages[1]!.durationMs, undefined);
});

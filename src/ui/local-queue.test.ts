import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalMessageQueue, shouldRecallQueue } from "./local-queue";

function queue() {
  let n = 0;
  return new LocalMessageQueue(() => `q${++n}`);
}

test("messages stack in order and send as one message", () => {
  const q = queue();
  q.add("first");
  q.add("  second  ");
  assert.equal(q.size, 2);
  assert.equal(q.takeForSending(), "first\n\nsecond");
  assert.equal(q.size, 0);
});

test("an empty queue sends nothing", () => {
  assert.equal(queue().takeForSending(), null);
});

test("blank messages are not queued", () => {
  const q = queue();
  q.add("   ");
  assert.equal(q.size, 0);
});

test("recalling for edit returns everything and empties the queue", () => {
  const q = queue();
  q.add("a");
  q.add("b");
  assert.equal(q.takeForEditing(), "a\n\nb");
  assert.equal(q.takeForSending(), null);
});

test("one queued message can be removed", () => {
  const q = queue();
  q.add("keep");
  q.add("drop");
  q.remove(q.messages[1]!.id);
  assert.deepEqual(q.messages.map((m) => m.text), ["keep"]);
});

test("up arrow recalls only from an empty composer with a non-empty queue", () => {
  assert.equal(shouldRecallQueue({ key: "ArrowUp", composerText: "", queued: 1, modifier: false }), true);
  assert.equal(shouldRecallQueue({ key: "ArrowUp", composerText: "draft", queued: 1, modifier: false }), false);
  assert.equal(shouldRecallQueue({ key: "ArrowUp", composerText: "", queued: 0, modifier: false }), false);
  assert.equal(shouldRecallQueue({ key: "ArrowUp", composerText: "", queued: 1, modifier: true }), false);
  assert.equal(shouldRecallQueue({ key: "ArrowDown", composerText: "", queued: 1, modifier: false }), false);
});

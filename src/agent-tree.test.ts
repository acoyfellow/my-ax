import assert from "node:assert/strict";
import { test } from "node:test";
import { childTaskMessage, doneLine, nextDoneDelivery, parentMessage, parseSpawnArgs, waitOutcome, waitSeconds } from "./agent-tree";

test("spawn needs a task and names the child from it", () => {
  assert.throws(() => parseSpawnArgs({}), /task is required/);
  assert.throws(() => parseSpawnArgs({ task: "   " }), /task is required/);
  assert.deepEqual(parseSpawnArgs({ task: "  check the build  " }), { task: "check the build", name: "check the build" });
  assert.equal(parseSpawnArgs({ task: "x", name: "  Build   check " }).name, "Build check");
  assert.equal(parseSpawnArgs({ task: "a".repeat(200) }).name.length, 80);
  assert.throws(() => parseSpawnArgs({ task: "a".repeat(20_001) }), /longer than/);
});

test("wait is bounded to 600 seconds", () => {
  assert.equal(waitSeconds(undefined), 120);
  assert.equal(waitSeconds(-5), 120);
  assert.equal(waitSeconds(30), 30);
  assert.equal(waitSeconds(99999), 600);
});

test("the child is told to end with a DONE line", () => {
  const message = childTaskMessage("p1", "count the files");
  assert.match(message, /parent conversation p1/);
  assert.match(message, /count the files/);
  assert.match(message, /DONE:/);
});

test("doneLine takes the last DONE line", () => {
  assert.equal(doneLine("work\nDONE: first\nmore\nDONE: second"), "DONE: second");
  assert.equal(doneLine("  DONE: padded  "), "DONE: padded");
  assert.equal(doneLine("no marker here"), null);
  assert.equal(doneLine("not DONE: inline"), null);
});

test("a DONE line is delivered once", () => {
  const replies = [{ entryId: 4, text: "hi\nDONE: built" }];
  const first = nextDoneDelivery(replies, 0);
  assert.deepEqual(first, { entryId: 4, line: "DONE: built" });
  assert.equal(nextDoneDelivery(replies, 4), null);
});

test("a later reply without DONE delivers nothing new", () => {
  const replies = [{ entryId: 4, text: "DONE: built" }, { entryId: 7, text: "anything else?" }];
  assert.equal(nextDoneDelivery(replies, 4), null);
});

test("a new DONE after a delivered one is delivered", () => {
  const replies = [{ entryId: 4, text: "DONE: one" }, { entryId: 9, text: "DONE: two" }];
  assert.deepEqual(nextDoneDelivery(replies, 4), { entryId: 9, line: "DONE: two" });
});

test("the parent sees who the message is from", () => {
  assert.equal(parentMessage("c1", "Build check", "DONE: ok"), "[message from child conversation Build check (c1)]\nDONE: ok");
});

test("wait reports done, empty, or still working", () => {
  assert.deepEqual(waitOutcome("kid", false, "DONE: ok", 30), { done: true, answer: "DONE: ok" });
  assert.equal(waitOutcome("kid", false, "", 30).answer, "kid finished with no answer");
  const pending = waitOutcome("kid", true, "", 30);
  assert.equal(pending.done, false);
  assert.match(pending.answer, /still working after 30s/);
});

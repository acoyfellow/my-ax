import assert from "node:assert/strict";
import test from "node:test";
import { extractFingerprint, formatDuplicateClose, hasLoopBoard, planSweep, SWEEP_MAX_CLOSES, SWEEP_MAX_QUEUES } from "./sweep";

test("same fingerprint keeps the lowest number and closes the rest", () => {
  const actions = planSweep([
    { number: 69, title: "bug: image", body: "fingerprint: `e8a37db7f3311f4b`", author: "o", state: "open", comments: ["## loop board"] },
    { number: 67, title: "bug: image", body: "fingerprint: `e8a37db7f3311f4b`", author: "o", state: "open", comments: ["## loop board"] },
    { number: 68, title: "bug: image", body: "fingerprint: `e8a37db7f3311f4b`", author: "o", state: "open", comments: ["## loop board"] },
  ]);
  assert.deepEqual(actions.filter((row) => row.action !== "queue"), [
    { action: "keep", number: 67, fingerprint: "e8a37db7f3311f4b" },
    { action: "close-duplicate", number: 69, keep: 67, fingerprint: "e8a37db7f3311f4b" },
    { action: "close-duplicate", number: 68, keep: 67, fingerprint: "e8a37db7f3311f4b" },
  ]);
});

test("issues without a loop board are queued once", () => {
  const actions = planSweep([
    { number: 74, title: "bug: race", body: "repro", author: "o", state: "open", comments: [] },
    { number: 75, title: "bug: sweep", body: "repro", author: "o", state: "open", comments: ["## loop board\nstage: labeled"] },
  ]);
  assert.ok(actions.some((row) => row.action === "queue" && row.number === 74));
  assert.ok(!actions.some((row) => row.action === "queue" && row.number === 75));
});

test("sweep caps closes and queues", () => {
  const issues = Array.from({ length: 20 }, (_, i) => ({
    number: 100 + i,
    title: "bug: x",
    body: i < 12 ? "fingerprint: `aaaaaaaaaaaaaaaa`" : "no print",
    author: "o",
    state: "open" as const,
    comments: i % 2 === 0 ? [] : ["## loop board"],
  }));
  const actions = planSweep(issues);
  assert.ok(actions.filter((row) => row.action === "close-duplicate").length <= SWEEP_MAX_CLOSES);
  assert.ok(actions.filter((row) => row.action === "queue").length <= SWEEP_MAX_QUEUES);
});

test("duplicate close text is public and names the keeper", () => {
  const body = formatDuplicateClose(67, "e8a37db7f3311f4b");
  assert.match(body, /#67/);
  assert.match(body, /e8a37db7f3311f4b/);
  assert.doesNotMatch(body, /employee|my-ax-private|hooks\.ax/);
});

test("fingerprint extractor is fail-closed", () => {
  assert.equal(extractFingerprint("no print"), null);
  assert.equal(extractFingerprint("fingerprint: `e8a37db7f3311f4b`"), "e8a37db7f3311f4b");
  assert.equal(hasLoopBoard(["hello", "## loop board\nstage: labeled"]), true);
});

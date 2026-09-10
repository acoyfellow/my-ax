import assert from "node:assert/strict";
import test from "node:test";
import { extractFingerprint, formatDuplicateClose, formatPlaceholderPrClose, formatRetryExhausted, hasLoopBoard, isBlockedStamp, isFactoryOnlyChange, loopBoardAttempts, planSweep, sweepLeaseId, SWEEP_MAX_ATTEMPTS, SWEEP_MAX_CLOSES, SWEEP_MAX_QUEUES } from "./sweep";

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

test("issues without an open PR are queued even if boarded", () => {
  const actions = planSweep([
    { number: 74, title: "bug: race", body: "repro", author: "o", state: "open", comments: [] },
    { number: 75, title: "bug: sweep", body: "repro", author: "o", state: "open", comments: ["## loop board\nstage: labeled"], labels: ["triage:draft"] },
  ]);
  assert.ok(actions.some((row) => row.action === "queue" && row.number === 74));
  assert.ok(actions.some((row) => row.action === "queue" && row.number === 75));
});

test("a blocked-stamp board is re-queued so the factory can try again", () => {
  const actions = planSweep([
    {
      number: 162,
      title: "bug: stall",
      body: "fingerprint: `dbcb9c47f004c45e`",
      author: "o",
      state: "open",
      comments: ["## loop board\nstage: blocked-stamp"],
      hasHead: true,
    },
  ]);
  assert.ok(actions.some((row) => row.action === "queue" && row.number === 162));
  assert.equal(isBlockedStamp(["## loop board\nstage: blocked-stamp"]), true);
  assert.equal(isBlockedStamp(["## loop board\nstage: pr-opened"]), false);
});

test("a boarded issue with a head but no PR is queued", () => {
  const actions = planSweep([
    { number: 67, title: "bug: image", body: "fingerprint: `e8a37db7f3311f4b`", author: "o", state: "open", comments: ["## loop board"], labels: ["triage:draft"], hasHead: true },
  ]);
  assert.ok(
    actions.some((row) => row.action === "queue" && row.number === 67),
    "speed to PR: boarded bugs with no open PR must be re-queued",
  );
});

test("a factory-only open PR is closed and routed to a human", () => {
  const actions = planSweep([
    { number: 153, title: "bug: stale", body: "repro", author: "o", state: "open", comments: [], hasOpenPr: true, openPr: { number: 165, files: [".factory/issue-153.md", "src/factory/issue-153.md"] } },
  ]);
  assert.deepEqual(actions, [{ action: "close-placeholder-pr", number: 153, prNumber: 165 }]);
  assert.equal(isFactoryOnlyChange([".factory/a", "src/factory/b"]), true);
  assert.equal(isFactoryOnlyChange([".factory/a", "src/index.tsx"]), false);
  assert.match(formatPlaceholderPrClose(153), /closed without merge or approval/);
});

test("an issue with an open PR is never re-queued", () => {
  const actions = planSweep([
    { number: 109, title: "bug: heal", body: "repro", author: "o", state: "open", comments: ["## loop board"], hasHead: true, hasOpenPr: true },
  ]);
  assert.deepEqual(actions, [], "an issue that already has an open PR is finished work");
});

test("an unboarded issue is still queued", () => {
  const actions = planSweep([
    { number: 70, title: "bug: new", body: "repro", author: "o", state: "open", comments: [], hasHead: false },
  ]);
  assert.ok(actions.some((row) => row.action === "queue" && row.number === 70));
});

test("an unexpired implementation lease keeps active work open", () => {
  const actions = planSweep([
    { number: 153, title: "bug", body: "repro", author: "o", state: "open", comments: ["## factory implementation lease\nrun: ter_1\nstate: active\nexpires: 2026-09-03T19:30:00Z"], labels: ["triage:needs-human"] },
  ], Date.parse("2026-09-03T19:00:00Z"));
  assert.deepEqual(actions, []);
});

test("an expired implementation lease does not close an unresolved issue", () => {
  const actions = planSweep([
    { number: 153, title: "bug", body: "repro", author: "o", state: "open", comments: ["## factory implementation lease\nrun: ter_1\nstate: active\nexpires: 2026-09-03T19:30:00Z"], labels: ["triage:needs-human"] },
  ], Date.parse("2026-09-03T19:31:00Z"));
  assert.deepEqual(actions, []);
});

test("needs-human issues remain open without repeat comments or retries", () => {
  const actions = planSweep([
    { number: 146, title: "blocked: access", body: "needs zero trust", author: "o", state: "open", comments: [], labels: ["triage:needs-human"] },
  ]);
  assert.deepEqual(actions, []);
});

test("a real open product PR receives the work and closes the issue", () => {
  const actions = planSweep([
    { number: 155, title: "bug: sessions", body: "repro", author: "o", state: "open", comments: [], hasOpenPr: true, openPr: { number: 169, files: ["src/session-title.ts", "src/session-title.test.ts"] } },
  ]);
  assert.deepEqual(actions, [{ action: "close-issue-to-pr", number: 155, prNumber: 169 }]);
});

test("a closed or parent-only linked PR does not close the issue", () => {
  const actions = planSweep([
    { number: 231, title: "bug: delegate", body: "repro", author: "o", state: "open", comments: [], labels: ["triage:draft"], linkedPr: { number: 235, files: ["src/delegate-many.ts"] } },
  ]);
  assert.deepEqual(actions, [{ action: "queue", number: 231 }]);
});

test("a boarded issue without draft opt-in stays open", () => {
  const actions = planSweep([
    { number: 174, title: "Feature: notifications", body: "request", author: "o", state: "open", comments: ["## loop board\nstage: labeled"], labels: ["bug"] },
  ]);
  assert.deepEqual(actions, []);
});

test("issue 213 stays open across repeated sweeps until implementation is opted in", () => {
  const issue = {
    number: 213, title: "Voice agent does not release mic for the next turn",
    body: "The assistant completes a reply. Listening is shown but microphone capture never resumes.",
    author: "acoyfellow", state: "open" as const, labels: ["bug"],
    comments: ["## Factory status\nA person must decide whether to start implementation.\n<!-- stage: labeled -->"],
  };
  for (let tick = 0; tick < 4; tick++) {
    assert.deepEqual(planSweep([issue], tick * 900_000), []);
  }
  assert.deepEqual(planSweep([{ ...issue, labels: ["bug", "triage:draft"] }]), [{ action: "queue", number: 213 }]);
});

test("retry exhaustion routes an opted-in issue to a human", () => {
  const comments = Array.from({ length: SWEEP_MAX_ATTEMPTS }, () => "## loop board\nstage: blocked-stamp");
  const actions = planSweep([
    { number: 175, title: "bug: exhausted", body: "repro", author: "o", state: "open", comments, labels: ["triage:draft"] },
  ]);
  assert.ok(actions.some((row) => row.action === "needs-human" && row.number === 175));
  assert.equal(loopBoardAttempts(comments), SWEEP_MAX_ATTEMPTS);
  assert.match(formatRetryExhausted(SWEEP_MAX_ATTEMPTS), /issue stays open/);
});

test("a failed implementation stays open after retry exhaustion", () => {
  const actions = planSweep([
    {
      number: 184,
      title: "bug: leading space",
      body: "repro",
      author: "owner",
      state: "open",
      comments: ["## loop board\nstage: retry-exhausted"],
      labels: ["bug", "triage:draft", "triage:needs-human"],
    },
  ]);
  assert.deepEqual(actions, []);
});

test("sweep workflow ids lease one issue per scheduled bucket", () => {
  assert.equal(sweepLeaseId(42, 900_001), sweepLeaseId(42, 1_799_999));
  assert.notEqual(sweepLeaseId(42, 899_999), sweepLeaseId(42, 900_001));
  assert.notEqual(sweepLeaseId(42, 900_001), sweepLeaseId(43, 900_001));
});

test("sweep never parks", () => {
  const actions = planSweep([
    { number: 76, title: "bug: heal", body: "repro", author: "o", state: "open", comments: ["## loop board"], hasHead: false },
  ]);
  assert.ok(!actions.some((row) => "action" in row && String(row.action) === "park"));
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

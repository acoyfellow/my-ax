import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PROMPT_CHARS, validateJobInput } from "./jobs";
import { MORNING_PICK_CADENCE_SECS, MORNING_PICK_DECLINE, MORNING_PICK_OPTIONS, MORNING_PICK_PROMPT, MORNING_PICK_QUESTION_PREFIX, MORNING_PICK_SHIP, MORNING_PICK_WRONG, morningPickAnswer, morningPickStats } from "./morning-pick";

test("the morning pick prompt fits a recurring job and is a valid daily job", () => {
  assert.ok(MORNING_PICK_PROMPT.length <= MAX_PROMPT_CHARS, `prompt is ${MORNING_PICK_PROMPT.length} chars`);
  const parsed = validateJobInput({ sessionId: "s1", threadMode: "specific_session", name: "Morning pick", prompt: MORNING_PICK_PROMPT, cadenceSecs: MORNING_PICK_CADENCE_SECS, maxRuns: null });
  assert.equal("tag" in parsed, false, JSON.stringify(parsed));
});

test("the prompt forbids merging before the owner taps ship and names the one question", () => {
  assert.match(MORNING_PICK_PROMPT, /Never merge/);
  assert.match(MORNING_PICK_PROMPT, /ask_user exactly once/);
  assert.ok(MORNING_PICK_PROMPT.includes(`"${MORNING_PICK_QUESTION_PREFIX}"`));
  for (const option of MORNING_PICK_OPTIONS) assert.ok(MORNING_PICK_PROMPT.includes(`"${option}"`), option);
});

test("answers map to the experiment's outcomes", () => {
  assert.equal(morningPickAnswer({ status: "completed", choice: MORNING_PICK_SHIP }), "shipped");
  assert.equal(morningPickAnswer({ status: "completed", choice: MORNING_PICK_DECLINE }), "declined");
  assert.equal(morningPickAnswer({ status: "completed", choice: MORNING_PICK_WRONG }), "questioned");
  assert.equal(morningPickAnswer({ status: "open", choice: null }), "pending");
  assert.equal(morningPickAnswer({ status: "aborted", choice: null }), "pending");
});

test("ship and question rates count only answered picks", () => {
  const stats = morningPickStats([
    { status: "completed", choice: MORNING_PICK_SHIP },
    { status: "completed", choice: MORNING_PICK_SHIP },
    { status: "completed", choice: MORNING_PICK_WRONG },
    { status: "completed", choice: MORNING_PICK_DECLINE },
    { status: "open", choice: null },
  ]);
  assert.deepEqual(stats, { picks: 5, shipped: 2, declined: 1, questioned: 1, pending: 1, shipRate: 0.5, questionRate: 0.25 });
});

test("no answers yet means no rate, not zero", () => {
  assert.deepEqual(morningPickStats([{ status: "open", choice: null }]), { picks: 1, shipped: 0, declined: 0, questioned: 0, pending: 1, shipRate: null, questionRate: null });
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnerPushPayload, MAX_PUSH_PAYLOAD_BYTES } from "./notify";

const base = {
  kind: "job.needs_input" as const,
  title: "Choose a deployment",
  body: "Which path should run?",
  href: "/api/decisions/run-decision-11111111-1111-4111-8111-111111111111",
};

function payloadFor(decision: { id: string; options: string[] }) {
  return buildOwnerPushPayload({ ...base, decision }, {
    destinationHref: base.href,
    attentionId: "11111111-1111-4111-8111-111111111111",
    unread: 1,
    progressTerminal: false,
  }).payload;
}

test("decision options become opaque indexed actions capped at two", () => {
  const payload = payloadFor({
    id: "run-decision-11111111-1111-4111-8111-111111111111",
    options: ["Ship now", "Wait for review", "Do not include this third action"],
  });
  assert.deepEqual(payload.actions, [
    { action: "decision:0", title: "Ship now" },
    { action: "decision:1", title: "Wait for review" },
  ]);
  assert.deepEqual(payload.decision, {
    id: "run-decision-11111111-1111-4111-8111-111111111111",
    options: ["Ship now", "Wait for review"],
  });
  assert.ok(payload.actions.every((action) => !["Ship now", "Wait for review", "Do not include this third action"].includes(action.action)));
});

test("an oversized decision falls back to navigation actions without truncating its values", () => {
  const payload = payloadFor({
    id: "run-decision-11111111-1111-4111-8111-111111111111",
    options: ["x".repeat(MAX_PUSH_PAYLOAD_BYTES), "Keep original mapping"],
  });
  assert.equal(payload.decision, undefined);
  assert.deepEqual(payload.actions, [
    { action: "open", title: "Open notification" },
    { action: "destination", title: "Open source" },
  ]);
  assert.ok(payload.actions.every((action) => !action.action.includes("x")));
});

test("decision action identifiers never contain option text", () => {
  const options = ["approve-with:colon", "reject/with/slash"];
  const payload = payloadFor({ id: "run-decision-11111111-1111-4111-8111-111111111111", options });
  assert.ok(payload.actions.every((action) => /^decision:[01]$/.test(action.action)));
  assert.ok(payload.actions.every((action) => options.every((option) => !action.action.includes(option))));
});

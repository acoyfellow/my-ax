import assert from "node:assert/strict";
import test from "node:test";
import { classifyAttentionItem } from "./attention-item-affordance";

test("a rate-limit heads-up reads as benign 'Retrying'", () => {
  const a = classifyAttentionItem({
    kind: "session.update",
    title: "My AX: paused on rate limit",
    body: "A recurring job is waiting out an inference rate limit and will retry automatically.",
  });
  assert.equal(a.tone, "retrying");
  assert.equal(a.badge, "Retrying");
});

test("actionable kinds read as 'Needs you'", () => {
  for (const kind of ["job.needs_input", "deploy.gate", "recipe.approval", "session.dead", "delegate.needs_input"]) {
    const a = classifyAttentionItem({ kind, title: "x", body: "y" });
    assert.equal(a.tone, "attention", `${kind} -> attention`);
    assert.equal(a.badge, "Needs you");
  }
});

test("ordinary informational pings stay quiet (no badge)", () => {
  const a = classifyAttentionItem({ kind: "session.update", title: "My AX finished", body: "Completed successfully." });
  assert.equal(a.tone, "info");
  assert.equal(a.badge, null);
});

test("rate-limit detection wins even for an actionable kind (still self-healing)", () => {
  const a = classifyAttentionItem({ kind: "job.needs_input", title: "x", body: "3021: rate limiting: inference request per min rate reached" });
  assert.equal(a.tone, "retrying", "a transient rate limit is not a needs-you alarm");
});

test("empty/unknown item is quiet info", () => {
  assert.deepEqual(classifyAttentionItem({}), { tone: "info", badge: null });
});

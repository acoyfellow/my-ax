import assert from "node:assert/strict";
import test from "node:test";
import { classifyJobHealth, jobResultAttr } from "./job-health";

test("paused job is muted, not a failure", () => {
  const h = classifyJobHealth({ status: "paused", last_error: "whatever" });
  assert.equal(h.state, "paused");
  assert.equal(h.tone, "muted");
});

test("transient gateway rate limit is 'rate-limited' with warn tone (NOT bad)", () => {
  const h = classifyJobHealth({ status: "active", last_error: "3021: rate limiting: inference request per min rate reached", last_run_at: "t" });
  assert.equal(h.state, "rate-limited");
  assert.equal(h.tone, "warn");
  assert.notEqual(h.tone, "bad");
  assert.doesNotMatch(h.label, /3021/, "does not surface the raw gateway code");
  assert.equal(jobResultAttr(h), "rate-limited");
});

test("a real error is 'failed' with bad tone and a short message", () => {
  const h = classifyJobHealth({ status: "active", last_error: "TypeError: cannot read property x of undefined ".repeat(10), last_run_at: "t" });
  assert.equal(h.state, "failed");
  assert.equal(h.tone, "bad");
  assert.ok(h.label.startsWith("failed · "));
  assert.ok(h.label.length <= 120, "error is truncated");
  assert.equal(jobResultAttr(h), "error");
});

test("a clean completed run is ok", () => {
  const h = classifyJobHealth({ status: "active", last_error: null, last_run_at: "t" });
  assert.equal(h.state, "ok");
  assert.equal(h.tone, "ok");
  assert.equal(jobResultAttr(h), "ok");
});

test("a never-run active job is waiting", () => {
  const h = classifyJobHealth({ status: "active", last_error: null, last_run_at: null });
  assert.equal(h.state, "waiting");
  assert.equal(h.tone, "muted");
  assert.equal(jobResultAttr(h), "ok");
});

test("429 and overloaded also classify as rate-limited", () => {
  assert.equal(classifyJobHealth({ status: "active", last_error: "HTTP 429 Too Many Requests", last_run_at: "t" }).state, "rate-limited");
  assert.equal(classifyJobHealth({ status: "active", last_error: "model overloaded", last_run_at: "t" }).state, "rate-limited");
});

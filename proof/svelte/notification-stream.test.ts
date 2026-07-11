import assert from "node:assert/strict";
import test from "node:test";
import {
  attentionToNotification,
  runToNotification,
  buildNotificationStream,
  unreadCount,
} from "./notification-stream";

test("attention items classify into the right stream types", () => {
  assert.equal(attentionToNotification({ id: "1", kind: "job.needs_input", title: "x", body: "y", created_at: "2026-01-01T00:00:00Z" }).type, "needs-you");
  assert.equal(attentionToNotification({ id: "2", kind: "session.update", title: "paused", body: "3021: rate limiting: inference request per min rate reached" }).type, "retrying");
  assert.equal(attentionToNotification({ id: "3", kind: "job.complete", title: "done", body: "" }).type, "done");
  assert.equal(attentionToNotification({ id: "4", kind: "session.update", title: "n", body: "b" }).type, "update");
});

test("an explicit actionable kind outranks a rate-limit mention in the body", () => {
  // Regression: job.needs_input whose body mentions 3021 must read 'needs-you',
  // not be softened to 'retrying' by the text heuristic.
  const n = attentionToNotification({ id: "m", kind: "job.needs_input", title: "Input required", body: "3021: rate limiting: inference request per min rate reached" });
  assert.equal(n.type, "needs-you");
  // A pure rate-limit ping with no actionable kind still classifies retrying.
  assert.equal(attentionToNotification({ id: "r", kind: "session.update", title: "paused", body: "3021: rate limiting" }).type, "retrying");
});

test("an attention item with a run receipt href exposes a widget action and 'ready' type", () => {
  const n = attentionToNotification({ id: "5", kind: "session.update", title: "Artifact", body: "ready", href: "/runs/abc" });
  assert.equal(n.type, "ready");
  assert.equal(n.widgetHref, "/runs/abc");
  assert.equal(n.href, "/runs/abc");
});

test("a plain conversation href is the primary action with no widget action", () => {
  const n = attentionToNotification({ id: "6", kind: "session.update", title: "t", body: "b", href: "/?session=s1" });
  assert.equal(n.href, "/?session=s1");
  assert.equal(n.widgetHref, null);
});

test("failed runs become 'failed' notifications with a widget (receipt) action", () => {
  const n = runToNotification({ id: "r1", status: "error", title: "Nightly", task_summary: "broke", updated_at: "2026-01-02T00:00:00Z" });
  assert.equal(n.type, "failed");
  assert.equal(n.tone, "bad");
  assert.equal(n.id, "run:r1");
  assert.equal(n.widgetHref, "/runs/r1");
  assert.ok(n.href && n.href.includes("run=r1"));
  assert.equal(n.unread, true);
});

test("stream merges both sources newest-first", () => {
  const stream = buildNotificationStream(
    [{ id: "a", kind: "session.update", title: "old ping", body: "", created_at: "2026-01-01T00:00:00Z" }],
    [{ id: "r1", status: "error", title: "recent fail", updated_at: "2026-01-03T00:00:00Z" }],
  );
  assert.deepEqual(stream.map((n) => n.title), ["recent fail", "old ping"]);
});

test("dismissed ids are filtered from the stream", () => {
  const stream = buildNotificationStream(
    [{ id: "a", kind: "session.update", title: "ping", created_at: "2026-01-01T00:00:00Z" }],
    [{ id: "r1", status: "error", title: "fail", updated_at: "2026-01-03T00:00:00Z" }],
    new Set(["run:r1"]),
  );
  assert.deepEqual(stream.map((n) => n.id), ["a"], "dismissed failed run is gone");
});

test("duplicate ids are de-duped", () => {
  const stream = buildNotificationStream(
    [
      { id: "a", kind: "session.update", title: "first", created_at: "2026-01-01T00:00:00Z" },
      { id: "a", kind: "session.update", title: "dupe", created_at: "2026-01-02T00:00:00Z" },
    ],
    [],
  );
  assert.equal(stream.length, 1);
});

test("unreadCount counts unseen items (attention seen_at clears unread)", () => {
  const stream = buildNotificationStream(
    [
      { id: "a", kind: "session.update", title: "unseen", created_at: "2026-01-01T00:00:00Z" },
      { id: "b", kind: "session.update", title: "seen", created_at: "2026-01-01T00:00:00Z", seen_at: "2026-01-01T00:01:00Z" },
    ],
    [{ id: "r1", status: "error", title: "fail", updated_at: "2026-01-03T00:00:00Z" }],
  );
  // unseen attention (a) + failed run (r1, always unread) = 2; seen (b) excluded.
  assert.equal(unreadCount(stream), 2);
});

test("empty sources -> empty stream", () => {
  assert.deepEqual(buildNotificationStream([], []), []);
  assert.equal(unreadCount([]), 0);
});

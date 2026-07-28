import assert from "node:assert/strict";
import test from "node:test";
import { reconcileSeen } from "./attention-state";

test("marking the visible page uses the authoritative remaining unread count", () => {
  const items = Array.from({ length: 20 }, (_, index) => ({ id: String(index), seen_at: null }));
  const result = reconcileSeen(items, 6, items.map((item) => item.id), "2026-06-19T00:00:00Z");

  // Six includes five older items plus one notification that arrived concurrently.
  assert.equal(result.unread, 6);
  assert.ok(result.items.every((item) => item.seen_at === "2026-06-19T00:00:00Z"));
});

test("reconciliation changes only ids accepted by the seen request", () => {
  const items = [{ id: "new", seen_at: null }, { id: "old", seen_at: "earlier" }];
  const result = reconcileSeen(items, 2, ["new"], "now");

  assert.deepEqual(result, {
    unread: 2,
    items: [{ id: "new", seen_at: "now" }, { id: "old", seen_at: "earlier" }],
  });
});

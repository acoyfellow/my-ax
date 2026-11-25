import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TILE_STATE_BYTES, mergeTileState, parseTileState, TILE_RUNTIME_JS } from "./tile-panel";

test("parseTileState and mergeTileState handle JSON patches and enforce size limits", () => {
  assert.deepEqual(parseTileState(null), {});
  assert.deepEqual(parseTileState("not-json"), {});
  assert.deepEqual(parseTileState("[1,2]"), {});
  assert.deepEqual(parseTileState('{"pct":42}'), { pct: 42 });

  const merged = mergeTileState({ step: "tests", pct: 42 }, { pct: 100, ok: true });
  assert.deepEqual(merged.state, { step: "tests", pct: 100, ok: true });
  assert.deepEqual(JSON.parse(merged.json), { step: "tests", pct: 100, ok: true });

  assert.throws(
    () => mergeTileState({}, { big: "x".repeat(MAX_TILE_STATE_BYTES + 100) }),
    /tile state exceeds/,
  );
});

test("TILE_RUNTIME_JS forwards non-interactive clicks, right-clicks, ready, and send messages", () => {
  assert.match(TILE_RUNTIME_JS, /my-ax:tile-ready/);
  assert.match(TILE_RUNTIME_JS, /my-ax:tile-state/);
  assert.match(TILE_RUNTIME_JS, /my-ax:tile-send/);
  assert.match(TILE_RUNTIME_JS, /my-ax:tile-select/);
  assert.match(TILE_RUNTIME_JS, /my-ax:tile-contextmenu/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { DESK_STATE_MAX_BYTES, applyDeskAppWrite, emptyDeskApp, parseDeskApp, stateByteLength } from "./desk-app";

test("an agent can point the desk at an app it authored", () => {
  const next = applyDeskAppWrite(emptyDeskApp(), { artifactId: "art-1" }, { author: "oracle" });
  assert.equal(next.artifactId, "art-1");
  assert.equal(next.updatedBy, "oracle");
});

test("the state is free form: any json shape is accepted", () => {
  const shapes: unknown[] = [
    { columns: [{ name: "todo", items: ["a"] }] },
    [1, 2, 3],
    "a plain string",
    42,
    { nested: { deep: { deeper: true } } },
  ];
  for (const shape of shapes) {
    const next = applyDeskAppWrite(emptyDeskApp(), { state: shape });
    assert.deepEqual(next.state, shape, `rejected a valid shape: ${JSON.stringify(shape)}`);
  }
});

test("there is no fixed status vocabulary to conform to", () => {
  const next = applyDeskAppWrite(emptyDeskApp(), { state: { items: [{ id: "x", phase: "claimed-by-oracle" }] } });
  const items = (next.state as { items: Array<{ phase: string }> }).items;
  assert.equal(items[0].phase, "claimed-by-oracle");
});

test("writing state leaves the artifact reference alone, and the reverse", () => {
  const withApp = applyDeskAppWrite(emptyDeskApp(), { artifactId: "art-9" });
  const withState = applyDeskAppWrite(withApp, { state: { a: 1 } });
  assert.equal(withState.artifactId, "art-9");
  const relinked = applyDeskAppWrite(withState, { artifactId: "art-10" });
  assert.deepEqual(relinked.state, { a: 1 });
});

test("an empty write is refused so a caller cannot silently clear the desk", () => {
  assert.throws(() => applyDeskAppWrite(emptyDeskApp(), {}), /requires state or artifactId/);
});

test("a non-object write is refused", () => {
  assert.throws(() => applyDeskAppWrite(emptyDeskApp(), "hello"), /must be an object/);
  assert.throws(() => applyDeskAppWrite(emptyDeskApp(), [1]), /must be an object/);
});

test("an oversized state is refused instead of silently truncated", () => {
  const big = { blob: "x".repeat(DESK_STATE_MAX_BYTES + 100) };
  assert.ok(stateByteLength(big) > DESK_STATE_MAX_BYTES);
  assert.throws(() => applyDeskAppWrite(emptyDeskApp(), { state: big }), /the limit is/);
});

test("a bad artifactId is refused, and null unlinks", () => {
  assert.throws(() => applyDeskAppWrite(emptyDeskApp(), { artifactId: "../etc/passwd" }), /valid id or null/);
  const linked = applyDeskAppWrite(emptyDeskApp(), { artifactId: "art-1" });
  assert.equal(applyDeskAppWrite(linked, { artifactId: null }).artifactId, null);
});

test("a stored row round-trips, and junk degrades to an empty desk", () => {
  const written = applyDeskAppWrite(emptyDeskApp(), { artifactId: "art-2", state: { k: "v" } }, { author: "me" });
  const parsed = parseDeskApp(JSON.parse(JSON.stringify(written)));
  assert.deepEqual(parsed, written);
  assert.equal(parseDeskApp("nonsense").artifactId, null);
  assert.equal(parseDeskApp({ artifactId: 5 }).artifactId, null);
});

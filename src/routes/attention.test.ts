import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAttentionSeenIds } from "./attention";

test("normalizeAttentionSeenIds keeps unique UUIDs in request order", () => {
  const one = "11111111-1111-4111-8111-111111111111";
  const two = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(normalizeAttentionSeenIds([one, "not-a-uuid", two, one, 42]), [one, two]);
});

test("normalizeAttentionSeenIds caps explicit acknowledgements", () => {
  const ids = Array.from({ length: 60 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
  const normalized = normalizeAttentionSeenIds(ids);
  assert.equal(normalized.length, 50);
  assert.equal(normalized[0], "00000000-1111-4111-8111-111111111111");
  assert.equal(normalized[49], "00000049-1111-4111-8111-111111111111");
});

test("normalizeAttentionSeenIds treats absent or malformed ids as empty explicit set", () => {
  assert.deepEqual(normalizeAttentionSeenIds(undefined), []);
  assert.deepEqual(normalizeAttentionSeenIds("11111111-1111-4111-8111-111111111111"), []);
});

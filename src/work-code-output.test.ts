import assert from "node:assert/strict";
import test from "node:test";
import {
  capWorkCodeCollection,
  capWorkCodeCollectionWithMetadata,
  capWorkCodeValue,
  WORK_CODE_CALLS_MAX_BYTES,
  WORK_CODE_CALLS_MAX_ENTRIES,
  WORK_CODE_LOGS_MAX_BYTES,
  WORK_CODE_LOGS_MAX_ENTRIES,
  WORK_CODE_RESULT_MAX_BYTES,
} from "./work-code-output";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

test("work_code result cap bounds nested strings before outer serialization", () => {
  const result = capWorkCodeValue({ output: "x".repeat(WORK_CODE_RESULT_MAX_BYTES * 8), nested: { more: "y".repeat(WORK_CODE_RESULT_MAX_BYTES * 8) } }, WORK_CODE_RESULT_MAX_BYTES);
  assert.ok(bytes(result) <= WORK_CODE_RESULT_MAX_BYTES);
});

test("work_code collection caps calls and logs by entry and byte budgets", () => {
  const values = Array.from({ length: WORK_CODE_LOGS_MAX_ENTRIES * 4 }, (_, index) => ({ index, output: "x".repeat(1024) }));
  const logs = capWorkCodeCollection(values, WORK_CODE_LOGS_MAX_ENTRIES, WORK_CODE_LOGS_MAX_BYTES);
  assert.ok(logs.length <= WORK_CODE_LOGS_MAX_ENTRIES);
  assert.ok(bytes(logs) <= WORK_CODE_LOGS_MAX_BYTES);

  const calls = capWorkCodeCollection(values, WORK_CODE_CALLS_MAX_ENTRIES, WORK_CODE_CALLS_MAX_BYTES);
  assert.ok(calls.length <= WORK_CODE_CALLS_MAX_ENTRIES);
  assert.ok(bytes(calls) <= WORK_CODE_CALLS_MAX_BYTES);
});

test("work_code collection metadata records omitted receipt calls without exposing them", () => {
  const values = Array.from({ length: WORK_CODE_CALLS_MAX_ENTRIES + 5 }, (_, index) => ({ index }));
  const capped = capWorkCodeCollectionWithMetadata(values, WORK_CODE_CALLS_MAX_ENTRIES, WORK_CODE_CALLS_MAX_BYTES);
  assert.equal(capped.truncated, true);
  assert.equal(capped.values.length, WORK_CODE_CALLS_MAX_ENTRIES);
  assert.ok(bytes(capped.values) <= WORK_CODE_CALLS_MAX_BYTES);
});

test("work_code collection budgets JSON array brackets, commas, and exact element bytes", () => {
  const values = [{ method: "read" }, { method: "write" }];
  const maxBytes = bytes(values);
  const capped = capWorkCodeCollectionWithMetadata([...values, { method: "delete" }], values.length + 1, maxBytes);
  assert.deepEqual(capped.values, values);
  assert.equal(capped.truncated, true);
  assert.equal(bytes(capped.values), maxBytes);
});

test("work_code collection remains byte-bounded after 5,000 rejected entries", () => {
  const values = Array.from({ length: 5_000 }, (_, index) => ({ index, error: "x".repeat(2_048) }));
  const capped = capWorkCodeCollectionWithMetadata(values, WORK_CODE_CALLS_MAX_ENTRIES, WORK_CODE_CALLS_MAX_BYTES);
  assert.equal(capped.truncated, true);
  assert.ok(capped.values.length <= WORK_CODE_CALLS_MAX_ENTRIES);
  assert.ok(bytes(capped.values) <= WORK_CODE_CALLS_MAX_BYTES);
});

test("work_code result cap handles circular values without propagating them to serialization", () => {
  const result: { self?: unknown } = {};
  result.self = result;
  assert.doesNotThrow(() => JSON.stringify(capWorkCodeValue(result, WORK_CODE_RESULT_MAX_BYTES)));
});

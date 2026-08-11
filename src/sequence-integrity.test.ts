import { expect, test } from "vitest";
import { checkSequenceIntegrity } from "./sequence-integrity";

const row = (sequence: number) => ({ sequence });

test("accepts a contiguous conversation sequence", () => {
  const result = checkSequenceIntegrity([row(1), row(2), row(3)]);

  expect(result.ok).toBe(true);
});

test("detects a missing sequence number", () => {
  const result = checkSequenceIntegrity([row(1), row(3)]);

  expect(result).toMatchObject({
    ok: false,
    violation: { kind: "gap", expected: 2, actual: 3 },
  });
});

test("detects a duplicate sequence number", () => {
  const result = checkSequenceIntegrity([row(1), row(2), row(2)]);

  expect(result).toMatchObject({
    ok: false,
    violation: { kind: "duplicate", expected: 3, actual: 2 },
  });
});

test("normalizes out-of-order rows before validation", () => {
  const result = checkSequenceIntegrity([row(3), row(1), row(2)]);

  expect(result).toMatchObject({ ok: true });
  expect(result.rows.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
});

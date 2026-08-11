export type SequenceIntegrityRow = {
  sequence: number | null;
};

export type SequenceIntegrityViolation = {
  kind: "duplicate" | "gap" | "invalid";
  expected: number | null;
  actual: number | null;
};

export type SequenceIntegrityResult<T extends SequenceIntegrityRow> =
  | { ok: true; rows: T[] }
  | { ok: false; rows: T[]; violation: SequenceIntegrityViolation };

export function checkSequenceIntegrity<T extends SequenceIntegrityRow>(
  rows: readonly T[],
  expectedStart = 1,
): SequenceIntegrityResult<T> {
  const normalizedRows = [...rows].sort((left, right) => sequenceSortValue(left.sequence) - sequenceSortValue(right.sequence));
  let expected = expectedStart;

  for (const row of normalizedRows) {
    if (!isSequenceNumber(row.sequence)) {
      return {
        ok: false,
        rows: normalizedRows,
        violation: { kind: "invalid", expected, actual: row.sequence },
      };
    }
    if (row.sequence === expected) {
      expected += 1;
      continue;
    }
    return {
      ok: false,
      rows: normalizedRows,
      violation: {
        kind: row.sequence < expected ? "duplicate" : "gap",
        expected,
        actual: row.sequence,
      },
    };
  }

  return { ok: true, rows: normalizedRows };
}

export function isSequenceNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function sequenceSortValue(value: number | null): number {
  return isSequenceNumber(value) ? value : Number.NEGATIVE_INFINITY;
}

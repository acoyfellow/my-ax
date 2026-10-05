import assert from "node:assert/strict";

export { describe, it, test } from "node:test";

function matchesObject(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") return Object.is(actual, expected);
  if (actual === null || typeof actual !== "object") return false;
  return Object.entries(expected).every(([key, value]) => matchesObject((actual as Record<string, unknown>)[key], value));
}

function contains(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "string") return actual.includes(String(expected));
  if (Array.isArray(actual)) return actual.includes(expected);
  return false;
}

export function expect(actual: unknown) {
  return {
    toBe: (expected: unknown) => assert.strictEqual(actual, expected),
    toEqual: (expected: unknown) => assert.deepStrictEqual(actual, expected),
    toBeNull: () => assert.strictEqual(actual, null),
    toHaveLength: (length: number) => assert.strictEqual((actual as { length: number }).length, length),
    toContain: (expected: unknown) => assert.ok(contains(actual, expected), `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`),
    toMatchObject: (expected: object) => assert.ok(matchesObject(actual, expected), `expected ${JSON.stringify(actual)} to match ${JSON.stringify(expected)}`),
    rejects: {
      toThrow: (message?: string | RegExp) => assert.rejects(actual as Promise<unknown>, message === undefined ? Error : (error: Error) => (typeof message === "string" ? error.message.includes(message) : message.test(error.message))),
    },
    not: {
      toContain: (expected: unknown) => assert.ok(!contains(actual, expected), `expected ${JSON.stringify(actual)} not to contain ${JSON.stringify(expected)}`),
    },
  };
}

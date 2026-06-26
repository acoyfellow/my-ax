import assert from "node:assert/strict";
import test from "node:test";
import { CODE_MODE_EXECUTION_TIMEOUT_MS } from "./code-mode-runtime";

test("Code Mode execution timeout follows the current runtime cohort", () => {
  assert.equal(CODE_MODE_EXECUTION_TIMEOUT_MS, 60_000);
});

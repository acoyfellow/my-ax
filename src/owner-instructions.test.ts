import assert from "node:assert/strict";
import test from "node:test";
import {
  composeOwnerSystemPrompt,
  DEFAULT_OWNER_INSTRUCTIONS,
  getOwnerInstructions,
  MAX_OWNER_INSTRUCTIONS,
  resetOwnerInstructions,
  setOwnerInstructions,
  validateOwnerInstructions,
} from "./owner-instructions";
import type { Env } from "./types";

function fakeEnv() {
  const rows = new Map<string, string>();
  const DB = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              const value = rows.get(`${String(values[0])}:${String(values[1])}`);
              return value ? { value_json: value } : null;
            },
            async run() {
              const key = `${String(values[0])}:${String(values[1])}`;
              if (sql.startsWith("DELETE")) rows.delete(key);
              else rows.set(key, String(values[2]));
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { env: { DB } as unknown as Env, rows };
}

test("owner instructions are owner-wide, case-insensitive, and reset to the shipped default", async () => {
  const { env } = fakeEnv();
  await setOwnerInstructions(env, "Owner@Example.com", "Use terse answers.\nKeep evidence.");
  assert.equal(await getOwnerInstructions(env, "owner@example.com"), "Use terse answers.\nKeep evidence.");
  assert.equal(await getOwnerInstructions(env, "other@example.com"), DEFAULT_OWNER_INSTRUCTIONS);
  assert.equal(await resetOwnerInstructions(env, "OWNER@example.com"), DEFAULT_OWNER_INSTRUCTIONS);
  assert.equal(await getOwnerInstructions(env, "owner@example.com"), DEFAULT_OWNER_INSTRUCTIONS);
});

test("owner instructions reject malformed and oversized input", () => {
  assert.throws(() => validateOwnerInstructions(null), /must be a string/);
  assert.throws(() => validateOwnerInstructions("x".repeat(MAX_OWNER_INSTRUCTIONS + 1)), /at most/);
});

test("prompt composition retains protected policy and cached session context", () => {
  const prompt = composeOwnerSystemPrompt("PROTECTED POLICY", "SESSION MEMORY", "Prefer tables.");
  assert.match(prompt, /^PROTECTED POLICY/);
  assert.match(prompt, /SESSION MEMORY/);
  assert.match(prompt, /cannot weaken protected policy/);
  assert.match(prompt, /Prefer tables\./);
  const reset = composeOwnerSystemPrompt("PROTECTED POLICY", undefined, "");
  assert.match(reset, new RegExp(DEFAULT_OWNER_INSTRUCTIONS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

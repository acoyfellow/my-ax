import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "./types";
import {
  DEFAULT_STARTERS,
  MAX_STARTERS,
  normalizeStarters,
  getConversationStarters,
  setConversationStarters,
} from "./conversation-starters";

test("normalizeStarters keeps valid entries and drops incomplete ones", () => {
  const out = normalizeStarters([
    { title: "A", prompt: "do a" },
    { title: "", prompt: "no title" },
    { title: "B", prompt: "" },
    { title: "C", hint: "with hint", prompt: "do c" },
    "garbage",
    null,
  ]);
  assert.deepEqual(out, [
    { title: "A", prompt: "do a" },
    { title: "C", hint: "with hint", prompt: "do c" },
  ]);
});

test("normalizeStarters caps count, lengths, and omits empty hints", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, prompt: `p${i}` }));
  const out = normalizeStarters(many);
  assert.equal(out.length, MAX_STARTERS);
  const long = normalizeStarters([{ title: "x".repeat(200), hint: "  ", prompt: "y".repeat(5000) }]);
  assert.ok(long[0].title.length <= 60);
  assert.ok(long[0].prompt.length <= 2000);
  assert.equal("hint" in long[0], false, "blank hint is omitted");
});

test("normalizeStarters rejects non-arrays", () => {
  assert.deepEqual(normalizeStarters(null), []);
  assert.deepEqual(normalizeStarters("nope"), []);
  assert.deepEqual(normalizeStarters({}), []);
});

function makeEnv() {
  const rows = new Map<string, string>();
  const db = {
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, " ").trim();
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async first<T = unknown>() {
          if (/SELECT value_json FROM owner_preferences/.test(q)) {
            const v = rows.get(`${bound[0]}|${bound[1]}`);
            return (v ? { value_json: v } : null) as T;
          }
          return null as T;
        },
        async run() {
          if (/INSERT INTO owner_preferences/.test(q)) rows.set(`${bound[0]}|${bound[1]}`, String(bound[2]));
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db } as unknown as Env, rows };
}

const OWNER = "Owner@Example.com";

test("getConversationStarters returns defaults when none stored", async () => {
  const { env } = makeEnv();
  assert.deepEqual(await getConversationStarters(env, OWNER), DEFAULT_STARTERS);
});

test("set then get round-trips a custom list (owner-normalized, lowercased key)", async () => {
  const { env } = makeEnv();
  const custom = [{ title: "My starter", hint: "does a thing", prompt: "please do a thing" }];
  const saved = await setConversationStarters(env, OWNER, custom);
  assert.deepEqual(saved, custom);
  assert.deepEqual(await getConversationStarters(env, "owner@example.com"), custom);
});

test("setConversationStarters with empty/invalid input resets to defaults", async () => {
  const { env } = makeEnv();
  const saved = await setConversationStarters(env, OWNER, []);
  assert.deepEqual(saved, DEFAULT_STARTERS);
  assert.deepEqual(await getConversationStarters(env, OWNER), DEFAULT_STARTERS);
});

test("getConversationStarters falls back to defaults if stored list is all-invalid", async () => {
  const { env, rows } = makeEnv();
  rows.set(`${OWNER.toLowerCase()}|conversation_starters.v1`, JSON.stringify({ starters: [{ title: "", prompt: "" }] }));
  assert.deepEqual(await getConversationStarters(env, OWNER), DEFAULT_STARTERS);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainRejected } from "./decide";
import { createSkillRecord, deleteSkillRecord, updateSkillRecord } from "./Skill/Skill.store";
import { decideWorkspaceSnapshot, saveBrowserRecording, saveSnippetProjection } from "./records";

type Call = { sql: string; binds: unknown[] };

function fakeDb(firstRow: unknown = null) {
  const calls: Call[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          return {
            run: async () => {
              calls.push({ sql, binds });
              return {};
            },
            first: async <T>() => firstRow as T | null,
            all: async <T>() => ({ results: [] as T[] }),
          };
        },
      };
    },
  };
  return { db, calls, writes: () => calls.filter((call) => !/^\s*SELECT/i.test(call.sql)) };
}

const skill = { name: "deploy", description: "Ship it", instructions: "Run the deploy", allowedToolsJson: "[]" };
const skillRow = { owner_email: "o@x", name: "deploy", description: "Ship it", instructions: "Run the deploy" };

test("a new skill is written after Domain accepts CreateSkill", async () => {
  const { db, writes } = fakeDb(null);
  await createSkillRecord(db, "o@x", "s1", "t", skill, null);
  assert.equal(writes().length, 1);
  assert.match(writes()[0].sql, /^INSERT INTO skills/);
});

test("creating a skill id that already exists is refused before any SQL", async () => {
  const { db, writes } = fakeDb(skillRow);
  await assert.rejects(createSkillRecord(db, "o@x", "s1", "t", skill, null), (error: unknown) => error instanceof DomainRejected && error.rejection._tag === "SkillAlreadyExists");
  assert.equal(writes().length, 0);
});

test("updating or deleting a missing skill is refused before any SQL", async () => {
  const { db, writes } = fakeDb(null);
  await assert.rejects(updateSkillRecord(db, "o@x", "s1", "t", skill), DomainRejected);
  await assert.rejects(deleteSkillRecord(db, "o@x", "s1"), DomainRejected);
  assert.equal(writes().length, 0);
});

test("an existing skill is updated and deleted through Domain", async () => {
  const { db, writes } = fakeDb(skillRow);
  await updateSkillRecord(db, "o@x", "s1", "t", skill);
  await deleteSkillRecord(db, "o@x", "s1");
  assert.deepEqual(writes().map((call) => call.sql.split(" ")[0]), ["UPDATE", "DELETE"]);
});

test("a snippet projection inserts when new and updates when it exists", async () => {
  const { db, writes } = fakeDb(null);
  const base = { id: "n1", owner: "o@x", name: "n", description: "d", code: "c", inputSchemaJson: "{}", connectorsJson: "[]", sourceRecipeId: "r", savedAt: 1, codemodeExecutionId: "e", now: "t" };
  await saveSnippetProjection(db, { ...base, existingId: null });
  await saveSnippetProjection(db, { ...base, existingId: "n0" });
  assert.deepEqual(writes().map((call) => call.sql.trim().split(" ")[0]), ["INSERT", "UPDATE"]);
});

test("a browser recording is created once and replaced after", async () => {
  const fresh = fakeDb(null);
  await saveBrowserRecording(fresh.db, "b1", "o@x", "s1");
  const again = fakeDb({ id: "b1" });
  await saveBrowserRecording(again.db, "b1", "o@x", "s1");
  assert.equal(fresh.writes().length + again.writes().length, 2);
});

test("workspace snapshot versions are decided by Domain", () => {
  assert.doesNotThrow(() => decideWorkspaceSnapshot("o@x", null, "b", null));
  assert.doesNotThrow(() => decideWorkspaceSnapshot("o@x", 3, "b", 10));
});

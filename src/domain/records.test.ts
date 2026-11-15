import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainRejected } from "./decide";
import { createSkillRecord, deleteSkillRecord, updateSkillRecord } from "./Skill/Skill.store";
import { decideWorkspaceSnapshot, saveBrowserRecording, saveSnippetProjection } from "./records";
import { testDb } from "./test-db";

const OWNER = "o@x";
const skill = { name: "deploy", description: "Ship it", instructions: "Run the deploy", allowedToolsJson: "[]" };

function skills(db: ReturnType<typeof testDb>) {
  return db.rows<{ description: string }>("SELECT description FROM skills WHERE id = 's1'");
}

async function withSkill() {
  const db = testDb();
  await createSkillRecord(db, OWNER, "s1", "t", skill, null);
  db.writes.length = 0;
  return db;
}

test("a new skill is written after Domain accepts CreateSkill", async () => {
  const db = testDb();
  await createSkillRecord(db, OWNER, "s1", "t", skill, null);
  assert.deepEqual(db.writes, ["INSERT INTO skills"]);
  assert.equal(skills(db).length, 1);
});

test("creating a skill id that already exists is refused before any SQL", async () => {
  const db = await withSkill();
  await assert.rejects(createSkillRecord(db, OWNER, "s1", "t", skill, null), (error: unknown) => error instanceof DomainRejected && error.rejection._tag === "SkillAlreadyExists");
  assert.deepEqual(db.writes, []);
});

test("updating or deleting a missing skill is refused before any SQL", async () => {
  const db = testDb();
  await assert.rejects(updateSkillRecord(db, OWNER, "s1", "t", skill), DomainRejected);
  await assert.rejects(deleteSkillRecord(db, OWNER, "s1"), DomainRejected);
  assert.deepEqual(db.writes, []);
});

test("an existing skill is updated and deleted through Domain", async () => {
  const db = await withSkill();
  await updateSkillRecord(db, OWNER, "s1", "t", { ...skill, description: "Ship it now" });
  assert.equal(skills(db)[0]?.description, "Ship it now");
  await deleteSkillRecord(db, OWNER, "s1");
  assert.deepEqual(db.writes.map((write) => write.split(" ")[0]), ["UPDATE", "DELETE"]);
  assert.deepEqual(skills(db), []);
});

test("a snippet projection inserts when new and updates when it exists", async () => {
  const db = testDb();
  const base = { id: "n1", owner: OWNER, name: "n", description: "d", code: "c", inputSchemaJson: "{}", connectorsJson: "[]", sourceRecipeId: "r", savedAt: 1, codemodeExecutionId: "e", now: "t" };
  await saveSnippetProjection(db, { ...base, existingId: null });
  await saveSnippetProjection(db, { ...base, description: "d2", existingId: "n1" });
  assert.deepEqual(db.writes.map((write) => write.split(" ")[0]), ["INSERT", "UPDATE"]);
});

test("a browser recording is created once and replaced after", async () => {
  const db = testDb();
  db.exec(`INSERT INTO sessions (id, name, status, owner_email) VALUES ('s1', 'Main', 'active', '${OWNER}')`);
  await saveBrowserRecording(db, "b1", OWNER, "s1");
  await saveBrowserRecording(db, "b1", OWNER, "s1");
  assert.equal(db.writes.length, 2);
});

test("workspace snapshot versions are decided by Domain", () => {
  assert.doesNotThrow(() => decideWorkspaceSnapshot(OWNER, null, "b", null));
  assert.doesNotThrow(() => decideWorkspaceSnapshot(OWNER, 3, "b", 10));
});

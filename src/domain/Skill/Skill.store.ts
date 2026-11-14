import { decide } from "../decide";
import { CreateSkill } from "./CreateSkill.command";
import { DeleteSkill } from "./DeleteSkill.command";
import { Skill, type SkillState } from "./Skill.aggregate";
import { UpdateSkill } from "./UpdateSkill.command";

type Statement = { run(): Promise<unknown>; first<T>(): Promise<T | null> };
export type SkillDb = { prepare(sql: string): { bind(...values: unknown[]): Statement } };

export type SkillWrite = { name: string; description: string; instructions: string; allowedToolsJson: string };

type Row = { owner_email: string; name: string; description: string; instructions: string };

async function load(db: SkillDb, owner: string, id: string): Promise<SkillState> {
  const row = await db.prepare("SELECT owner_email, name, description, instructions FROM skills WHERE id = ? AND owner_email = ?").bind(id, owner).first<Row>();
  return row ? { _tag: "Present", ownerEmail: row.owner_email, name: row.name, description: row.description, instructions: row.instructions } : { _tag: "Missing" };
}

export async function createSkillRecord(db: SkillDb, owner: string, id: string, at: string, write: SkillWrite, sourceSessionId: string | null): Promise<void> {
  decide(Skill, id, await load(db, owner, id), new CreateSkill({ ownerEmail: owner, name: write.name, description: write.description, instructions: write.instructions }));
  await db.prepare("INSERT INTO skills (id, owner_email, name, description, instructions, allowed_tools_json, source_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, owner, write.name, write.description, write.instructions, write.allowedToolsJson, sourceSessionId, at, at)
    .run();
}

export async function updateSkillRecord(db: SkillDb, owner: string, id: string, at: string, write: SkillWrite): Promise<void> {
  decide(Skill, id, await load(db, owner, id), new UpdateSkill({ name: write.name, description: write.description, instructions: write.instructions }));
  await db.prepare("UPDATE skills SET name = ?, description = ?, instructions = ?, allowed_tools_json = ?, updated_at = ? WHERE id = ? AND owner_email = ?")
    .bind(write.name, write.description, write.instructions, write.allowedToolsJson, at, id, owner)
    .run();
}

export async function deleteSkillRecord(db: SkillDb, owner: string, id: string): Promise<void> {
  decide(Skill, id, await load(db, owner, id), new DeleteSkill());
  await db.prepare("DELETE FROM skills WHERE id = ? AND owner_email = ?").bind(id, owner).run();
}

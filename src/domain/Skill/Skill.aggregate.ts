import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { CreateSkill, SkillCreated } from "./CreateSkill.command";
import { DeleteSkill, SkillDeleted } from "./DeleteSkill.command";
import { UpdateSkill, SkillUpdated } from "./UpdateSkill.command";
import { SkillFields } from "./Skill.fields";
import { SkillId } from "./Skill.id";
import { SkillAlreadyExists, SkillNotFound } from "./SkillRejections.rejection";

export const SkillState = Schema.Union([
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("Present", SkillFields),
  Schema.TaggedStruct("Deleted", {}),
]);
export type SkillState = typeof SkillState.Type;

export class Skill extends Domain.Aggregate("Skill", {
  id: SkillId,
  state: SkillState,
  initial: { _tag: "Missing" },
  commands: [CreateSkill, UpdateSkill, DeleteSkill],
  decide: {
    CreateSkill: (current, cmd) =>
      current._tag === "Present" ? new SkillAlreadyExists() : [new SkillCreated({ ownerEmail: cmd.ownerEmail, name: cmd.name, description: cmd.description, instructions: cmd.instructions })],
    UpdateSkill: (current, cmd) =>
      current._tag !== "Present" ? new SkillNotFound() : [new SkillUpdated({ name: cmd.name, description: cmd.description, instructions: cmd.instructions })],
    DeleteSkill: (current) => (current._tag !== "Present" ? new SkillNotFound() : [new SkillDeleted()]),
  },
  evolve: {
    SkillCreated: (_, e) => ({ _tag: "Present" as const, ownerEmail: e.ownerEmail, name: e.name, description: e.description, instructions: e.instructions }),
    SkillUpdated: (current, e) => (current._tag === "Present" ? { ...current, name: e.name, description: e.description, instructions: e.instructions } : current),
    SkillDeleted: () => ({ _tag: "Deleted" as const }),
  },
}) {}

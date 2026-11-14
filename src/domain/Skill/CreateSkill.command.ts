import * as Domain from "@alchemy.run/domain";
import { SkillFields } from "./Skill.fields";
import { SkillId } from "./Skill.id";
import { SkillAlreadyExists } from "./SkillRejections.rejection";

export class SkillCreated extends Domain.Event("SkillCreated", SkillFields) {}

export class CreateSkill extends Domain.Command("CreateSkill", {
  target: SkillId,
  input: SkillFields,
  events: [SkillCreated],
  rejects: [SkillAlreadyExists],
}) {}

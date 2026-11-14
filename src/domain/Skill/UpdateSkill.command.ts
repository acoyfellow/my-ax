import * as Domain from "@alchemy.run/domain";
import { SkillChanges } from "./Skill.fields";
import { SkillId } from "./Skill.id";
import { SkillNotFound } from "./SkillRejections.rejection";

export class SkillUpdated extends Domain.Event("SkillUpdated", SkillChanges) {}

export class UpdateSkill extends Domain.Command("UpdateSkill", {
  target: SkillId,
  input: SkillChanges,
  events: [SkillUpdated],
  rejects: [SkillNotFound],
}) {}

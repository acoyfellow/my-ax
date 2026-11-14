import * as Domain from "@alchemy.run/domain";
import { SkillId } from "./Skill.id";
import { SkillNotFound } from "./SkillRejections.rejection";

export class SkillDeleted extends Domain.Event("SkillDeleted", {}) {}

export class DeleteSkill extends Domain.Command("DeleteSkill", {
  target: SkillId,
  events: [SkillDeleted],
  rejects: [SkillNotFound],
}) {}

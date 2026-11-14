import * as Domain from "@alchemy.run/domain";

export class SkillNotFound extends Domain.Rejection("SkillNotFound") {}
export class SkillAlreadyExists extends Domain.Rejection("SkillAlreadyExists") {}

import * as Domain from "@alchemy.run/domain";
import { EmailId } from "./Email.id";
import { EmailNotFound } from "./EmailRejections.rejection";

export class EmailDeleted extends Domain.Event("EmailDeleted", {}) {}

export class DeleteEmail extends Domain.Command("DeleteEmail", {
  target: EmailId,
  events: [EmailDeleted],
  rejects: [EmailNotFound],
}) {}

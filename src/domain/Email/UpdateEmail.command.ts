import * as Domain from "@alchemy.run/domain";
import { EmailChanges } from "./Email.fields";
import { EmailId } from "./Email.id";
import { EmailNotFound } from "./EmailRejections.rejection";

export class EmailUpdated extends Domain.Event("EmailUpdated", EmailChanges) {}

export class UpdateEmail extends Domain.Command("UpdateEmail", {
  target: EmailId,
  input: EmailChanges,
  events: [EmailUpdated],
  rejects: [EmailNotFound],
}) {}

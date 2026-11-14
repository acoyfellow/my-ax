import * as Domain from "@alchemy.run/domain";
import { EmailFields } from "./Email.fields";
import { EmailId } from "./Email.id";
import { EmailAlreadyExists } from "./EmailRejections.rejection";

export class EmailCreated extends Domain.Event("EmailCreated", EmailFields) {}

export class CreateEmail extends Domain.Command("CreateEmail", {
  target: EmailId,
  input: EmailFields,
  events: [EmailCreated],
  rejects: [EmailAlreadyExists],
}) {}

import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { CreateEmail, EmailCreated } from "./CreateEmail.command";
import { DeleteEmail, EmailDeleted } from "./DeleteEmail.command";
import { UpdateEmail, EmailUpdated } from "./UpdateEmail.command";
import { EmailFields } from "./Email.fields";
import { EmailId } from "./Email.id";
import { EmailAlreadyExists, EmailNotFound } from "./EmailRejections.rejection";

export const EmailState = Schema.Union([
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("Present", EmailFields),
  Schema.TaggedStruct("Deleted", {}),
]);
export type EmailState = typeof EmailState.Type;

export class Email extends Domain.Aggregate("Email", {
  id: EmailId,
  state: EmailState,
  initial: { _tag: "Missing" },
  commands: [CreateEmail, UpdateEmail, DeleteEmail],
  decide: {
    CreateEmail: (current, cmd) =>
      current._tag === "Present" ? new EmailAlreadyExists() : [new EmailCreated({ ownerEmail: cmd.ownerEmail, subject: cmd.subject, readAt: cmd.readAt })],
    UpdateEmail: (current, cmd) =>
      current._tag !== "Present" ? new EmailNotFound() : [new EmailUpdated({ subject: cmd.subject, readAt: cmd.readAt })],
    DeleteEmail: (current) => (current._tag !== "Present" ? new EmailNotFound() : [new EmailDeleted()]),
  },
  evolve: {
    EmailCreated: (_, e) => ({ _tag: "Present" as const, ownerEmail: e.ownerEmail, subject: e.subject, readAt: e.readAt }),
    EmailUpdated: (current, e) => (current._tag === "Present" ? { ...current, subject: e.subject, readAt: e.readAt } : current),
    EmailDeleted: () => ({ _tag: "Deleted" as const }),
  },
}) {}

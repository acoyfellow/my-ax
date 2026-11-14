import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { CreateSnippet, SnippetCreated } from "./CreateSnippet.command";
import { DeleteSnippet, SnippetDeleted } from "./DeleteSnippet.command";
import { UpdateSnippet, SnippetUpdated } from "./UpdateSnippet.command";
import { SnippetFields } from "./Snippet.fields";
import { SnippetId } from "./Snippet.id";
import { SnippetAlreadyExists, SnippetNotFound } from "./SnippetRejections.rejection";

export const SnippetState = Schema.Union([
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("Present", SnippetFields),
  Schema.TaggedStruct("Deleted", {}),
]);
export type SnippetState = typeof SnippetState.Type;

export class Snippet extends Domain.Aggregate("Snippet", {
  id: SnippetId,
  state: SnippetState,
  initial: { _tag: "Missing" },
  commands: [CreateSnippet, UpdateSnippet, DeleteSnippet],
  decide: {
    CreateSnippet: (current, cmd) =>
      current._tag === "Present" ? new SnippetAlreadyExists() : [new SnippetCreated({ ownerEmail: cmd.ownerEmail, name: cmd.name, body: cmd.body })],
    UpdateSnippet: (current, cmd) =>
      current._tag !== "Present" ? new SnippetNotFound() : [new SnippetUpdated({ name: cmd.name, body: cmd.body })],
    DeleteSnippet: (current) => (current._tag !== "Present" ? new SnippetNotFound() : [new SnippetDeleted()]),
  },
  evolve: {
    SnippetCreated: (_, e) => ({ _tag: "Present" as const, ownerEmail: e.ownerEmail, name: e.name, body: e.body }),
    SnippetUpdated: (current, e) => (current._tag === "Present" ? { ...current, name: e.name, body: e.body } : current),
    SnippetDeleted: () => ({ _tag: "Deleted" as const }),
  },
}) {}

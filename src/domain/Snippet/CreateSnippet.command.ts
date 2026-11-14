import * as Domain from "@alchemy.run/domain";
import { SnippetFields } from "./Snippet.fields";
import { SnippetId } from "./Snippet.id";
import { SnippetAlreadyExists } from "./SnippetRejections.rejection";

export class SnippetCreated extends Domain.Event("SnippetCreated", SnippetFields) {}

export class CreateSnippet extends Domain.Command("CreateSnippet", {
  target: SnippetId,
  input: SnippetFields,
  events: [SnippetCreated],
  rejects: [SnippetAlreadyExists],
}) {}

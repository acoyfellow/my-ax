import * as Domain from "@alchemy.run/domain";
import { SnippetChanges } from "./Snippet.fields";
import { SnippetId } from "./Snippet.id";
import { SnippetNotFound } from "./SnippetRejections.rejection";

export class SnippetUpdated extends Domain.Event("SnippetUpdated", SnippetChanges) {}

export class UpdateSnippet extends Domain.Command("UpdateSnippet", {
  target: SnippetId,
  input: SnippetChanges,
  events: [SnippetUpdated],
  rejects: [SnippetNotFound],
}) {}

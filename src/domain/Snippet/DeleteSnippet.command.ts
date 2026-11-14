import * as Domain from "@alchemy.run/domain";
import { SnippetId } from "./Snippet.id";
import { SnippetNotFound } from "./SnippetRejections.rejection";

export class SnippetDeleted extends Domain.Event("SnippetDeleted", {}) {}

export class DeleteSnippet extends Domain.Command("DeleteSnippet", {
  target: SnippetId,
  events: [SnippetDeleted],
  rejects: [SnippetNotFound],
}) {}

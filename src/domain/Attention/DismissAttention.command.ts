import * as Domain from "@alchemy.run/domain";
import { AttentionId } from "./Attention.id";
import { AttentionNotFound } from "./AttentionRejections.rejection";

export class AttentionDismissed extends Domain.Event("AttentionDismissed", {}) {}

export class DismissAttention extends Domain.Command("DismissAttention", {
  target: AttentionId,
  events: [AttentionDismissed],
  rejects: [AttentionNotFound],
}) {}

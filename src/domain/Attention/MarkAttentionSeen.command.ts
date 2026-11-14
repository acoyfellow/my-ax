import * as Domain from "@alchemy.run/domain";
import { AttentionId } from "./Attention.id";
import { AttentionNotFound, AttentionTransitionRefused } from "./AttentionRejections.rejection";

export class AttentionSeen extends Domain.Event("AttentionSeen", {}) {}

export class MarkAttentionSeen extends Domain.Command("MarkAttentionSeen", {
  target: AttentionId,
  events: [AttentionSeen],
  rejects: [AttentionNotFound, AttentionTransitionRefused],
}) {}

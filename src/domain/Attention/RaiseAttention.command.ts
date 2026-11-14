import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { AttentionId } from "./Attention.id";
import { AttentionAlreadyExists } from "./AttentionRejections.rejection";

export class AttentionRaised extends Domain.Event("AttentionRaised", { ownerEmail: Schema.String, stage: Schema.Literals(["Unseen", "Seen"]) }) {}

export class RaiseAttention extends Domain.Command("RaiseAttention", {
  target: AttentionId,
  input: { ownerEmail: Schema.String, stage: Schema.Literals(["Unseen", "Seen"]) },
  events: [AttentionRaised],
  rejects: [AttentionAlreadyExists],
}) {}

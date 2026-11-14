import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RaiseAttention, AttentionRaised } from "./RaiseAttention.command";
import { AttentionId } from "./Attention.id";
import { AttentionAlreadyExists, AttentionNotFound, AttentionTransitionRefused } from "./AttentionRejections.rejection";
import { MarkAttentionSeen, AttentionSeen } from "./MarkAttentionSeen.command";
import { AttentionDismissed, DismissAttention } from "./DismissAttention.command";

export const ATTENTION_STAGES = ["Unseen", "Seen"] as const;
export type AttentionStage = (typeof ATTENTION_STAGES)[number];

export const AttentionState = Schema.Union([
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("Present", { ownerEmail: Schema.String, stage: Schema.Literals(ATTENTION_STAGES) }),
]);
export type AttentionState = typeof AttentionState.Type;

type Rule = { from: readonly AttentionStage[]; to: AttentionStage; event: () => { readonly _tag: string } };

export const ATTENTION_RULES = {
  MarkAttentionSeen: { from: ["Unseen"], to: "Seen", event: () => new AttentionSeen() },
} as const satisfies Record<string, Rule>;
export type AttentionCommandName = keyof typeof ATTENTION_RULES;

function transition<C extends AttentionCommandName>(current: AttentionState, command: C) {
  if (current._tag === "Missing") return new AttentionNotFound();
  const rule: Rule = ATTENTION_RULES[command];
  if (!rule.from.includes(current.stage)) return new AttentionTransitionRefused({ status: current.stage, command });
  return [rule.event() as ReturnType<(typeof ATTENTION_RULES)[C]["event"]>];
}

const moved = (current: AttentionState, stage: AttentionStage): AttentionState => (current._tag === "Present" ? { ...current, stage } : current);

export class Attention extends Domain.Aggregate("Attention", {
  id: AttentionId,
  state: AttentionState,
  initial: { _tag: "Missing" },
  commands: [RaiseAttention, MarkAttentionSeen, DismissAttention],
  decide: {
    RaiseAttention: (current, cmd) => (current._tag !== "Missing" ? new AttentionAlreadyExists() : [new AttentionRaised({ ownerEmail: cmd.ownerEmail, stage: cmd.stage })]),
    MarkAttentionSeen: (current) => transition(current, "MarkAttentionSeen"),
    DismissAttention: (current) => (current._tag === "Missing" ? new AttentionNotFound() : [new AttentionDismissed()]),
  },
  evolve: {
    AttentionRaised: (_, e) => ({ _tag: "Present" as const, ownerEmail: e.ownerEmail, stage: e.stage }),
    AttentionSeen: (current) => moved(current, "Seen"),
    AttentionDismissed: () => ({ _tag: "Missing" as const }),
  },
}) {}

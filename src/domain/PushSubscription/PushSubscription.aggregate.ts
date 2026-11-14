import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { CreatePushSubscription, PushSubscriptionCreated } from "./CreatePushSubscription.command";
import { DeletePushSubscription, PushSubscriptionDeleted } from "./DeletePushSubscription.command";
import { UpdatePushSubscription, PushSubscriptionUpdated } from "./UpdatePushSubscription.command";
import { PushSubscriptionFields } from "./PushSubscription.fields";
import { PushSubscriptionId } from "./PushSubscription.id";
import { PushSubscriptionAlreadyExists, PushSubscriptionNotFound } from "./PushSubscriptionRejections.rejection";

export const PushSubscriptionState = Schema.Union([
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("Present", PushSubscriptionFields),
  Schema.TaggedStruct("Deleted", {}),
]);
export type PushSubscriptionState = typeof PushSubscriptionState.Type;

export class PushSubscription extends Domain.Aggregate("PushSubscription", {
  id: PushSubscriptionId,
  state: PushSubscriptionState,
  initial: { _tag: "Missing" },
  commands: [CreatePushSubscription, UpdatePushSubscription, DeletePushSubscription],
  decide: {
    CreatePushSubscription: (current, cmd) =>
      current._tag === "Present" ? new PushSubscriptionAlreadyExists() : [new PushSubscriptionCreated({ ownerEmail: cmd.ownerEmail, endpoint: cmd.endpoint })],
    UpdatePushSubscription: (current, cmd) =>
      current._tag !== "Present" ? new PushSubscriptionNotFound() : [new PushSubscriptionUpdated({ endpoint: cmd.endpoint })],
    DeletePushSubscription: (current) => (current._tag !== "Present" ? new PushSubscriptionNotFound() : [new PushSubscriptionDeleted()]),
  },
  evolve: {
    PushSubscriptionCreated: (_, e) => ({ _tag: "Present" as const, ownerEmail: e.ownerEmail, endpoint: e.endpoint }),
    PushSubscriptionUpdated: (current, e) => (current._tag === "Present" ? { ...current, endpoint: e.endpoint } : current),
    PushSubscriptionDeleted: () => ({ _tag: "Deleted" as const }),
  },
}) {}

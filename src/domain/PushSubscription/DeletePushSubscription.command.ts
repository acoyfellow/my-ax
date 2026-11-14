import * as Domain from "@alchemy.run/domain";
import { PushSubscriptionId } from "./PushSubscription.id";
import { PushSubscriptionNotFound } from "./PushSubscriptionRejections.rejection";

export class PushSubscriptionDeleted extends Domain.Event("PushSubscriptionDeleted", {}) {}

export class DeletePushSubscription extends Domain.Command("DeletePushSubscription", {
  target: PushSubscriptionId,
  events: [PushSubscriptionDeleted],
  rejects: [PushSubscriptionNotFound],
}) {}

import * as Domain from "@alchemy.run/domain";
import { PushSubscriptionChanges } from "./PushSubscription.fields";
import { PushSubscriptionId } from "./PushSubscription.id";
import { PushSubscriptionNotFound } from "./PushSubscriptionRejections.rejection";

export class PushSubscriptionUpdated extends Domain.Event("PushSubscriptionUpdated", PushSubscriptionChanges) {}

export class UpdatePushSubscription extends Domain.Command("UpdatePushSubscription", {
  target: PushSubscriptionId,
  input: PushSubscriptionChanges,
  events: [PushSubscriptionUpdated],
  rejects: [PushSubscriptionNotFound],
}) {}

import * as Domain from "@alchemy.run/domain";
import { PushSubscriptionFields } from "./PushSubscription.fields";
import { PushSubscriptionId } from "./PushSubscription.id";
import { PushSubscriptionAlreadyExists } from "./PushSubscriptionRejections.rejection";

export class PushSubscriptionCreated extends Domain.Event("PushSubscriptionCreated", PushSubscriptionFields) {}

export class CreatePushSubscription extends Domain.Command("CreatePushSubscription", {
  target: PushSubscriptionId,
  input: PushSubscriptionFields,
  events: [PushSubscriptionCreated],
  rejects: [PushSubscriptionAlreadyExists],
}) {}

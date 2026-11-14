import * as Domain from "@alchemy.run/domain";

export class PushSubscriptionNotFound extends Domain.Rejection("PushSubscriptionNotFound") {}
export class PushSubscriptionAlreadyExists extends Domain.Rejection("PushSubscriptionAlreadyExists") {}

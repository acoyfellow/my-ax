import * as Domain from "@alchemy.run/domain";

export class WidgetNotFound extends Domain.Rejection("WidgetNotFound") {}
export class WidgetAlreadyExists extends Domain.Rejection("WidgetAlreadyExists") {}

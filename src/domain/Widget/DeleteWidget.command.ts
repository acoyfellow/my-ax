import * as Domain from "@alchemy.run/domain";
import { WidgetId } from "./Widget.id";
import { WidgetNotFound } from "./WidgetRejections.rejection";

export class WidgetDeleted extends Domain.Event("WidgetDeleted", {}) {}

export class DeleteWidget extends Domain.Command("DeleteWidget", {
  target: WidgetId,
  events: [WidgetDeleted],
  rejects: [WidgetNotFound],
}) {}

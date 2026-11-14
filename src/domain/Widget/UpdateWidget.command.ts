import * as Domain from "@alchemy.run/domain";
import { WidgetChanges } from "./Widget.fields";
import { WidgetId } from "./Widget.id";
import { WidgetNotFound } from "./WidgetRejections.rejection";

export class WidgetUpdated extends Domain.Event("WidgetUpdated", WidgetChanges) {}

export class UpdateWidget extends Domain.Command("UpdateWidget", {
  target: WidgetId,
  input: WidgetChanges,
  events: [WidgetUpdated],
  rejects: [WidgetNotFound],
}) {}

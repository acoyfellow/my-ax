import * as Domain from "@alchemy.run/domain";
import { WidgetFields } from "./Widget.fields";
import { WidgetId } from "./Widget.id";
import { WidgetAlreadyExists } from "./WidgetRejections.rejection";

export class WidgetCreated extends Domain.Event("WidgetCreated", WidgetFields) {}

export class CreateWidget extends Domain.Command("CreateWidget", {
  target: WidgetId,
  input: WidgetFields,
  events: [WidgetCreated],
  rejects: [WidgetAlreadyExists],
}) {}

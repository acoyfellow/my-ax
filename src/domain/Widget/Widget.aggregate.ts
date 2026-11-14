import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { CreateWidget, WidgetCreated } from "./CreateWidget.command";
import { DeleteWidget, WidgetDeleted } from "./DeleteWidget.command";
import { UpdateWidget, WidgetUpdated } from "./UpdateWidget.command";
import { WidgetFields } from "./Widget.fields";
import { WidgetId } from "./Widget.id";
import { WidgetAlreadyExists, WidgetNotFound } from "./WidgetRejections.rejection";

export const WidgetState = Schema.Union([
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("Present", WidgetFields),
  Schema.TaggedStruct("Deleted", {}),
]);
export type WidgetState = typeof WidgetState.Type;

export class Widget extends Domain.Aggregate("Widget", {
  id: WidgetId,
  state: WidgetState,
  initial: { _tag: "Missing" },
  commands: [CreateWidget, UpdateWidget, DeleteWidget],
  decide: {
    CreateWidget: (current, cmd) =>
      current._tag === "Present" ? new WidgetAlreadyExists() : [new WidgetCreated({ ownerEmail: cmd.ownerEmail, title: cmd.title, sourceHash: cmd.sourceHash, librarySaved: cmd.librarySaved })],
    UpdateWidget: (current, cmd) =>
      current._tag !== "Present" ? new WidgetNotFound() : [new WidgetUpdated({ title: cmd.title, sourceHash: cmd.sourceHash, librarySaved: cmd.librarySaved })],
    DeleteWidget: (current) => (current._tag !== "Present" ? new WidgetNotFound() : [new WidgetDeleted()]),
  },
  evolve: {
    WidgetCreated: (_, e) => ({ _tag: "Present" as const, ownerEmail: e.ownerEmail, title: e.title, sourceHash: e.sourceHash, librarySaved: e.librarySaved }),
    WidgetUpdated: (current, e) => (current._tag === "Present" ? { ...current, title: e.title, sourceHash: e.sourceHash, librarySaved: e.librarySaved } : current),
    WidgetDeleted: () => ({ _tag: "Deleted" as const }),
  },
}) {}

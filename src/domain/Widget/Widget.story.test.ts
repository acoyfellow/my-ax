import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { MyAx } from "../MyAx.model";
import { Widget } from "./Widget.aggregate";
import { CreateWidget, WidgetCreated } from "./CreateWidget.command";
import { DeleteWidget, WidgetDeleted } from "./DeleteWidget.command";
import { UpdateWidget, WidgetUpdated } from "./UpdateWidget.command";
import { WidgetAlreadyExists, WidgetNotFound } from "./WidgetRejections.rejection";

const story = Story.make(MyAx);
const ref = Widget.ref("x1");
const OWNER = "owner@example.com";
const fields = { title: "sample", sourceHash: "sample", librarySaved: true };
const changes = { title: "changed", sourceHash: "changed", librarySaved: false };
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

test("the model with Widget is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("create, update and delete a widget", () =>
  run(
    story(
      Story.when(ref, new CreateWidget({ ownerEmail: OWNER, ...fields })),
      Story.then(ref, new WidgetCreated({ ownerEmail: OWNER, ...fields })),
      Story.state(ref, { _tag: "Present", ...fields }),
      Story.when(ref, new UpdateWidget(changes)),
      Story.then(ref, new WidgetUpdated(changes)),
      Story.state(ref, { _tag: "Present", ownerEmail: OWNER, ...changes }),
      Story.when(ref, new DeleteWidget()),
      Story.then(ref, new WidgetDeleted()),
      Story.state(ref, { _tag: "Deleted" }),
    ),
  ));

test("a widget cannot be created twice", () =>
  run(
    story(
      Story.given(ref, new WidgetCreated({ ownerEmail: OWNER, ...fields })),
      Story.when(ref, new CreateWidget({ ownerEmail: OWNER, ...fields })),
      Story.rejected(new WidgetAlreadyExists()),
    ),
  ));

test("a widget that does not exist cannot be updated or deleted", () =>
  run(
    story(
      Story.when(ref, new UpdateWidget(changes)),
      Story.rejected(new WidgetNotFound()),
      Story.when(ref, new DeleteWidget()),
      Story.rejected(new WidgetNotFound()),
    ),
  ));

test("a deleted widget cannot be updated or deleted again, but can be created fresh", () =>
  run(
    story(
      Story.given(ref, new WidgetCreated({ ownerEmail: OWNER, ...fields }), new WidgetDeleted()),
      Story.when(ref, new UpdateWidget(changes)),
      Story.rejected(new WidgetNotFound()),
      Story.when(ref, new DeleteWidget()),
      Story.rejected(new WidgetNotFound()),
      Story.when(ref, new CreateWidget({ ownerEmail: OWNER, ...changes })),
      Story.then(ref, new WidgetCreated({ ownerEmail: OWNER, ...changes })),
      Story.state(ref, { _tag: "Present", ...changes }),
    ),
  ));

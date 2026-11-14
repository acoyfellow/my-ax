import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { MyAx } from "../MyAx.model";
import { BrowserRecording } from "./BrowserRecording.aggregate";
import { CreateBrowserRecording, BrowserRecordingCreated } from "./CreateBrowserRecording.command";
import { DeleteBrowserRecording, BrowserRecordingDeleted } from "./DeleteBrowserRecording.command";
import { UpdateBrowserRecording, BrowserRecordingUpdated } from "./UpdateBrowserRecording.command";
import { BrowserRecordingAlreadyExists, BrowserRecordingNotFound } from "./BrowserRecordingRejections.rejection";

const story = Story.make(MyAx);
const ref = BrowserRecording.ref("x1");
const OWNER = "owner@example.com";
const fields = { storageKey: "sample" };
const changes = { storageKey: "changed" };
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

test("the model with BrowserRecording is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("create, update and delete a browser recording", () =>
  run(
    story(
      Story.when(ref, new CreateBrowserRecording({ ownerEmail: OWNER, ...fields })),
      Story.then(ref, new BrowserRecordingCreated({ ownerEmail: OWNER, ...fields })),
      Story.state(ref, { _tag: "Present", ...fields }),
      Story.when(ref, new UpdateBrowserRecording(changes)),
      Story.then(ref, new BrowserRecordingUpdated(changes)),
      Story.state(ref, { _tag: "Present", ownerEmail: OWNER, ...changes }),
      Story.when(ref, new DeleteBrowserRecording()),
      Story.then(ref, new BrowserRecordingDeleted()),
      Story.state(ref, { _tag: "Deleted" }),
    ),
  ));

test("a browser recording cannot be created twice", () =>
  run(
    story(
      Story.given(ref, new BrowserRecordingCreated({ ownerEmail: OWNER, ...fields })),
      Story.when(ref, new CreateBrowserRecording({ ownerEmail: OWNER, ...fields })),
      Story.rejected(new BrowserRecordingAlreadyExists()),
    ),
  ));

test("a browser recording that does not exist cannot be updated or deleted", () =>
  run(
    story(
      Story.when(ref, new UpdateBrowserRecording(changes)),
      Story.rejected(new BrowserRecordingNotFound()),
      Story.when(ref, new DeleteBrowserRecording()),
      Story.rejected(new BrowserRecordingNotFound()),
    ),
  ));

test("a deleted browser recording cannot be updated or deleted again, but can be created fresh", () =>
  run(
    story(
      Story.given(ref, new BrowserRecordingCreated({ ownerEmail: OWNER, ...fields }), new BrowserRecordingDeleted()),
      Story.when(ref, new UpdateBrowserRecording(changes)),
      Story.rejected(new BrowserRecordingNotFound()),
      Story.when(ref, new DeleteBrowserRecording()),
      Story.rejected(new BrowserRecordingNotFound()),
      Story.when(ref, new CreateBrowserRecording({ ownerEmail: OWNER, ...changes })),
      Story.then(ref, new BrowserRecordingCreated({ ownerEmail: OWNER, ...changes })),
      Story.state(ref, { _tag: "Present", ...changes }),
    ),
  ));

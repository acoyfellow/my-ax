import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { MyAx } from "../MyAx.model";
import { AudioMessage } from "./AudioMessage.aggregate";
import { CreateAudioMessage, AudioMessageCreated } from "./CreateAudioMessage.command";
import { DeleteAudioMessage, AudioMessageDeleted } from "./DeleteAudioMessage.command";
import { UpdateAudioMessage, AudioMessageUpdated } from "./UpdateAudioMessage.command";
import { AudioMessageAlreadyExists, AudioMessageNotFound } from "./AudioMessageRejections.rejection";

const story = Story.make(MyAx);
const ref = AudioMessage.ref("x1");
const OWNER = "owner@example.com";
const fields = { storageKey: "sample" };
const changes = { storageKey: "changed" };
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

test("the model with AudioMessage is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("create, update and delete a audio message", () =>
  run(
    story(
      Story.when(ref, new CreateAudioMessage({ ownerEmail: OWNER, ...fields })),
      Story.then(ref, new AudioMessageCreated({ ownerEmail: OWNER, ...fields })),
      Story.state(ref, { _tag: "Present", ...fields }),
      Story.when(ref, new UpdateAudioMessage(changes)),
      Story.then(ref, new AudioMessageUpdated(changes)),
      Story.state(ref, { _tag: "Present", ownerEmail: OWNER, ...changes }),
      Story.when(ref, new DeleteAudioMessage()),
      Story.then(ref, new AudioMessageDeleted()),
      Story.state(ref, { _tag: "Deleted" }),
    ),
  ));

test("a audio message cannot be created twice", () =>
  run(
    story(
      Story.given(ref, new AudioMessageCreated({ ownerEmail: OWNER, ...fields })),
      Story.when(ref, new CreateAudioMessage({ ownerEmail: OWNER, ...fields })),
      Story.rejected(new AudioMessageAlreadyExists()),
    ),
  ));

test("a audio message that does not exist cannot be updated or deleted", () =>
  run(
    story(
      Story.when(ref, new UpdateAudioMessage(changes)),
      Story.rejected(new AudioMessageNotFound()),
      Story.when(ref, new DeleteAudioMessage()),
      Story.rejected(new AudioMessageNotFound()),
    ),
  ));

test("a deleted audio message cannot be updated or deleted again, but can be created fresh", () =>
  run(
    story(
      Story.given(ref, new AudioMessageCreated({ ownerEmail: OWNER, ...fields }), new AudioMessageDeleted()),
      Story.when(ref, new UpdateAudioMessage(changes)),
      Story.rejected(new AudioMessageNotFound()),
      Story.when(ref, new DeleteAudioMessage()),
      Story.rejected(new AudioMessageNotFound()),
      Story.when(ref, new CreateAudioMessage({ ownerEmail: OWNER, ...changes })),
      Story.then(ref, new AudioMessageCreated({ ownerEmail: OWNER, ...changes })),
      Story.state(ref, { _tag: "Present", ...changes }),
    ),
  ));

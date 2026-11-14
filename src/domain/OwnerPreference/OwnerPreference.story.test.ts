import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { MyAx } from "../MyAx.model";
import { OwnerPreference } from "./OwnerPreference.aggregate";
import { CreateOwnerPreference, OwnerPreferenceCreated } from "./CreateOwnerPreference.command";
import { DeleteOwnerPreference, OwnerPreferenceDeleted } from "./DeleteOwnerPreference.command";
import { UpdateOwnerPreference, OwnerPreferenceUpdated } from "./UpdateOwnerPreference.command";
import { OwnerPreferenceAlreadyExists, OwnerPreferenceNotFound } from "./OwnerPreferenceRejections.rejection";

const story = Story.make(MyAx);
const ref = OwnerPreference.ref("x1");
const OWNER = "owner@example.com";
const fields = { valueJson: "sample" };
const changes = { valueJson: "changed" };
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

test("the model with OwnerPreference is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("create, update and delete a owner preference", () =>
  run(
    story(
      Story.when(ref, new CreateOwnerPreference({ ownerEmail: OWNER, ...fields })),
      Story.then(ref, new OwnerPreferenceCreated({ ownerEmail: OWNER, ...fields })),
      Story.state(ref, { _tag: "Present", ...fields }),
      Story.when(ref, new UpdateOwnerPreference(changes)),
      Story.then(ref, new OwnerPreferenceUpdated(changes)),
      Story.state(ref, { _tag: "Present", ownerEmail: OWNER, ...changes }),
      Story.when(ref, new DeleteOwnerPreference()),
      Story.then(ref, new OwnerPreferenceDeleted()),
      Story.state(ref, { _tag: "Deleted" }),
    ),
  ));

test("a owner preference cannot be created twice", () =>
  run(
    story(
      Story.given(ref, new OwnerPreferenceCreated({ ownerEmail: OWNER, ...fields })),
      Story.when(ref, new CreateOwnerPreference({ ownerEmail: OWNER, ...fields })),
      Story.rejected(new OwnerPreferenceAlreadyExists()),
    ),
  ));

test("a owner preference that does not exist cannot be updated or deleted", () =>
  run(
    story(
      Story.when(ref, new UpdateOwnerPreference(changes)),
      Story.rejected(new OwnerPreferenceNotFound()),
      Story.when(ref, new DeleteOwnerPreference()),
      Story.rejected(new OwnerPreferenceNotFound()),
    ),
  ));

test("a deleted owner preference cannot be updated or deleted again, but can be created fresh", () =>
  run(
    story(
      Story.given(ref, new OwnerPreferenceCreated({ ownerEmail: OWNER, ...fields }), new OwnerPreferenceDeleted()),
      Story.when(ref, new UpdateOwnerPreference(changes)),
      Story.rejected(new OwnerPreferenceNotFound()),
      Story.when(ref, new DeleteOwnerPreference()),
      Story.rejected(new OwnerPreferenceNotFound()),
      Story.when(ref, new CreateOwnerPreference({ ownerEmail: OWNER, ...changes })),
      Story.then(ref, new OwnerPreferenceCreated({ ownerEmail: OWNER, ...changes })),
      Story.state(ref, { _tag: "Present", ...changes }),
    ),
  ));

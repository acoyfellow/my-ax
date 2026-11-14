import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { MyAx } from "../MyAx.model";
import { PushSubscription } from "./PushSubscription.aggregate";
import { CreatePushSubscription, PushSubscriptionCreated } from "./CreatePushSubscription.command";
import { DeletePushSubscription, PushSubscriptionDeleted } from "./DeletePushSubscription.command";
import { UpdatePushSubscription, PushSubscriptionUpdated } from "./UpdatePushSubscription.command";
import { PushSubscriptionAlreadyExists, PushSubscriptionNotFound } from "./PushSubscriptionRejections.rejection";

const story = Story.make(MyAx);
const ref = PushSubscription.ref("x1");
const OWNER = "owner@example.com";
const fields = { endpoint: "sample" };
const changes = { endpoint: "changed" };
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

test("the model with PushSubscription is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("create, update and delete a push subscription", () =>
  run(
    story(
      Story.when(ref, new CreatePushSubscription({ ownerEmail: OWNER, ...fields })),
      Story.then(ref, new PushSubscriptionCreated({ ownerEmail: OWNER, ...fields })),
      Story.state(ref, { _tag: "Present", ...fields }),
      Story.when(ref, new UpdatePushSubscription(changes)),
      Story.then(ref, new PushSubscriptionUpdated(changes)),
      Story.state(ref, { _tag: "Present", ownerEmail: OWNER, ...changes }),
      Story.when(ref, new DeletePushSubscription()),
      Story.then(ref, new PushSubscriptionDeleted()),
      Story.state(ref, { _tag: "Deleted" }),
    ),
  ));

test("a push subscription cannot be created twice", () =>
  run(
    story(
      Story.given(ref, new PushSubscriptionCreated({ ownerEmail: OWNER, ...fields })),
      Story.when(ref, new CreatePushSubscription({ ownerEmail: OWNER, ...fields })),
      Story.rejected(new PushSubscriptionAlreadyExists()),
    ),
  ));

test("a push subscription that does not exist cannot be updated or deleted", () =>
  run(
    story(
      Story.when(ref, new UpdatePushSubscription(changes)),
      Story.rejected(new PushSubscriptionNotFound()),
      Story.when(ref, new DeletePushSubscription()),
      Story.rejected(new PushSubscriptionNotFound()),
    ),
  ));

test("a deleted push subscription cannot be updated or deleted again, but can be created fresh", () =>
  run(
    story(
      Story.given(ref, new PushSubscriptionCreated({ ownerEmail: OWNER, ...fields }), new PushSubscriptionDeleted()),
      Story.when(ref, new UpdatePushSubscription(changes)),
      Story.rejected(new PushSubscriptionNotFound()),
      Story.when(ref, new DeletePushSubscription()),
      Story.rejected(new PushSubscriptionNotFound()),
      Story.when(ref, new CreatePushSubscription({ ownerEmail: OWNER, ...changes })),
      Story.then(ref, new PushSubscriptionCreated({ ownerEmail: OWNER, ...changes })),
      Story.state(ref, { _tag: "Present", ...changes }),
    ),
  ));

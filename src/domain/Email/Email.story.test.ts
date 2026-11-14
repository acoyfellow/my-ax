import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { MyAx } from "../MyAx.model";
import { Email } from "./Email.aggregate";
import { CreateEmail, EmailCreated } from "./CreateEmail.command";
import { DeleteEmail, EmailDeleted } from "./DeleteEmail.command";
import { UpdateEmail, EmailUpdated } from "./UpdateEmail.command";
import { EmailAlreadyExists, EmailNotFound } from "./EmailRejections.rejection";

const story = Story.make(MyAx);
const ref = Email.ref("x1");
const OWNER = "owner@example.com";
const fields = { subject: "sample", readAt: null };
const changes = { subject: "changed", readAt: "set" };
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

test("the model with Email is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("create, update and delete a email", () =>
  run(
    story(
      Story.when(ref, new CreateEmail({ ownerEmail: OWNER, ...fields })),
      Story.then(ref, new EmailCreated({ ownerEmail: OWNER, ...fields })),
      Story.state(ref, { _tag: "Present", ...fields }),
      Story.when(ref, new UpdateEmail(changes)),
      Story.then(ref, new EmailUpdated(changes)),
      Story.state(ref, { _tag: "Present", ownerEmail: OWNER, ...changes }),
      Story.when(ref, new DeleteEmail()),
      Story.then(ref, new EmailDeleted()),
      Story.state(ref, { _tag: "Deleted" }),
    ),
  ));

test("a email cannot be created twice", () =>
  run(
    story(
      Story.given(ref, new EmailCreated({ ownerEmail: OWNER, ...fields })),
      Story.when(ref, new CreateEmail({ ownerEmail: OWNER, ...fields })),
      Story.rejected(new EmailAlreadyExists()),
    ),
  ));

test("a email that does not exist cannot be updated or deleted", () =>
  run(
    story(
      Story.when(ref, new UpdateEmail(changes)),
      Story.rejected(new EmailNotFound()),
      Story.when(ref, new DeleteEmail()),
      Story.rejected(new EmailNotFound()),
    ),
  ));

test("a deleted email cannot be updated or deleted again, but can be created fresh", () =>
  run(
    story(
      Story.given(ref, new EmailCreated({ ownerEmail: OWNER, ...fields }), new EmailDeleted()),
      Story.when(ref, new UpdateEmail(changes)),
      Story.rejected(new EmailNotFound()),
      Story.when(ref, new DeleteEmail()),
      Story.rejected(new EmailNotFound()),
      Story.when(ref, new CreateEmail({ ownerEmail: OWNER, ...changes })),
      Story.then(ref, new EmailCreated({ ownerEmail: OWNER, ...changes })),
      Story.state(ref, { _tag: "Present", ...changes }),
    ),
  ));

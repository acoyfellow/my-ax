import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { MyAx } from "../MyAx.model";
import { Snippet } from "./Snippet.aggregate";
import { CreateSnippet, SnippetCreated } from "./CreateSnippet.command";
import { DeleteSnippet, SnippetDeleted } from "./DeleteSnippet.command";
import { UpdateSnippet, SnippetUpdated } from "./UpdateSnippet.command";
import { SnippetAlreadyExists, SnippetNotFound } from "./SnippetRejections.rejection";

const story = Story.make(MyAx);
const ref = Snippet.ref("x1");
const OWNER = "owner@example.com";
const fields = { name: "sample", body: "sample" };
const changes = { name: "changed", body: "changed" };
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

test("the model with Snippet is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("create, update and delete a snippet", () =>
  run(
    story(
      Story.when(ref, new CreateSnippet({ ownerEmail: OWNER, ...fields })),
      Story.then(ref, new SnippetCreated({ ownerEmail: OWNER, ...fields })),
      Story.state(ref, { _tag: "Present", ...fields }),
      Story.when(ref, new UpdateSnippet(changes)),
      Story.then(ref, new SnippetUpdated(changes)),
      Story.state(ref, { _tag: "Present", ownerEmail: OWNER, ...changes }),
      Story.when(ref, new DeleteSnippet()),
      Story.then(ref, new SnippetDeleted()),
      Story.state(ref, { _tag: "Deleted" }),
    ),
  ));

test("a snippet cannot be created twice", () =>
  run(
    story(
      Story.given(ref, new SnippetCreated({ ownerEmail: OWNER, ...fields })),
      Story.when(ref, new CreateSnippet({ ownerEmail: OWNER, ...fields })),
      Story.rejected(new SnippetAlreadyExists()),
    ),
  ));

test("a snippet that does not exist cannot be updated or deleted", () =>
  run(
    story(
      Story.when(ref, new UpdateSnippet(changes)),
      Story.rejected(new SnippetNotFound()),
      Story.when(ref, new DeleteSnippet()),
      Story.rejected(new SnippetNotFound()),
    ),
  ));

test("a deleted snippet cannot be updated or deleted again, but can be created fresh", () =>
  run(
    story(
      Story.given(ref, new SnippetCreated({ ownerEmail: OWNER, ...fields }), new SnippetDeleted()),
      Story.when(ref, new UpdateSnippet(changes)),
      Story.rejected(new SnippetNotFound()),
      Story.when(ref, new DeleteSnippet()),
      Story.rejected(new SnippetNotFound()),
      Story.when(ref, new CreateSnippet({ ownerEmail: OWNER, ...changes })),
      Story.then(ref, new SnippetCreated({ ownerEmail: OWNER, ...changes })),
      Story.state(ref, { _tag: "Present", ...changes }),
    ),
  ));

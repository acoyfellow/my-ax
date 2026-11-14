import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { MyAx } from "../MyAx.model";
import { Computer } from "./Computer.aggregate";
import { CreateComputer, ComputerCreated } from "./CreateComputer.command";
import { DeleteComputer, ComputerDeleted } from "./DeleteComputer.command";
import { UpdateComputer, ComputerUpdated } from "./UpdateComputer.command";
import { ComputerAlreadyExists, ComputerNotFound } from "./ComputerRejections.rejection";

const story = Story.make(MyAx);
const ref = Computer.ref("x1");
const OWNER = "owner@example.com";
const fields = { title: "sample" };
const changes = { title: "changed" };
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

test("the model with Computer is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("create, update and delete a computer", () =>
  run(
    story(
      Story.when(ref, new CreateComputer({ ownerEmail: OWNER, ...fields })),
      Story.then(ref, new ComputerCreated({ ownerEmail: OWNER, ...fields })),
      Story.state(ref, { _tag: "Present", ...fields }),
      Story.when(ref, new UpdateComputer(changes)),
      Story.then(ref, new ComputerUpdated(changes)),
      Story.state(ref, { _tag: "Present", ownerEmail: OWNER, ...changes }),
      Story.when(ref, new DeleteComputer()),
      Story.then(ref, new ComputerDeleted()),
      Story.state(ref, { _tag: "Deleted" }),
    ),
  ));

test("a computer cannot be created twice", () =>
  run(
    story(
      Story.given(ref, new ComputerCreated({ ownerEmail: OWNER, ...fields })),
      Story.when(ref, new CreateComputer({ ownerEmail: OWNER, ...fields })),
      Story.rejected(new ComputerAlreadyExists()),
    ),
  ));

test("a computer that does not exist cannot be updated or deleted", () =>
  run(
    story(
      Story.when(ref, new UpdateComputer(changes)),
      Story.rejected(new ComputerNotFound()),
      Story.when(ref, new DeleteComputer()),
      Story.rejected(new ComputerNotFound()),
    ),
  ));

test("a deleted computer cannot be updated or deleted again, but can be created fresh", () =>
  run(
    story(
      Story.given(ref, new ComputerCreated({ ownerEmail: OWNER, ...fields }), new ComputerDeleted()),
      Story.when(ref, new UpdateComputer(changes)),
      Story.rejected(new ComputerNotFound()),
      Story.when(ref, new DeleteComputer()),
      Story.rejected(new ComputerNotFound()),
      Story.when(ref, new CreateComputer({ ownerEmail: OWNER, ...changes })),
      Story.then(ref, new ComputerCreated({ ownerEmail: OWNER, ...changes })),
      Story.state(ref, { _tag: "Present", ...changes }),
    ),
  ));

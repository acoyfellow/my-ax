import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { MyAx } from "../MyAx.model";
import { ComputerSnapshot } from "./ComputerSnapshot.aggregate";
import { CreateComputerSnapshot, ComputerSnapshotCreated } from "./CreateComputerSnapshot.command";
import { DeleteComputerSnapshot, ComputerSnapshotDeleted } from "./DeleteComputerSnapshot.command";
import { UpdateComputerSnapshot, ComputerSnapshotUpdated } from "./UpdateComputerSnapshot.command";
import { ComputerSnapshotAlreadyExists, ComputerSnapshotNotFound } from "./ComputerSnapshotRejections.rejection";

const story = Story.make(MyAx);
const ref = ComputerSnapshot.ref("x1");
const OWNER = "owner@example.com";
const fields = { backupId: "sample", backupDir: "sample", snapshotVersion: 1 };
const changes = { backupId: "changed", backupDir: "changed", snapshotVersion: 2 };
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

test("the model with ComputerSnapshot is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("create, update and delete a computer snapshot", () =>
  run(
    story(
      Story.when(ref, new CreateComputerSnapshot({ ownerEmail: OWNER, ...fields })),
      Story.then(ref, new ComputerSnapshotCreated({ ownerEmail: OWNER, ...fields })),
      Story.state(ref, { _tag: "Present", ...fields }),
      Story.when(ref, new UpdateComputerSnapshot(changes)),
      Story.then(ref, new ComputerSnapshotUpdated(changes)),
      Story.state(ref, { _tag: "Present", ownerEmail: OWNER, ...changes }),
      Story.when(ref, new DeleteComputerSnapshot()),
      Story.then(ref, new ComputerSnapshotDeleted()),
      Story.state(ref, { _tag: "Deleted" }),
    ),
  ));

test("a computer snapshot cannot be created twice", () =>
  run(
    story(
      Story.given(ref, new ComputerSnapshotCreated({ ownerEmail: OWNER, ...fields })),
      Story.when(ref, new CreateComputerSnapshot({ ownerEmail: OWNER, ...fields })),
      Story.rejected(new ComputerSnapshotAlreadyExists()),
    ),
  ));

test("a computer snapshot that does not exist cannot be updated or deleted", () =>
  run(
    story(
      Story.when(ref, new UpdateComputerSnapshot(changes)),
      Story.rejected(new ComputerSnapshotNotFound()),
      Story.when(ref, new DeleteComputerSnapshot()),
      Story.rejected(new ComputerSnapshotNotFound()),
    ),
  ));

test("a deleted computer snapshot cannot be updated or deleted again, but can be created fresh", () =>
  run(
    story(
      Story.given(ref, new ComputerSnapshotCreated({ ownerEmail: OWNER, ...fields }), new ComputerSnapshotDeleted()),
      Story.when(ref, new UpdateComputerSnapshot(changes)),
      Story.rejected(new ComputerSnapshotNotFound()),
      Story.when(ref, new DeleteComputerSnapshot()),
      Story.rejected(new ComputerSnapshotNotFound()),
      Story.when(ref, new CreateComputerSnapshot({ ownerEmail: OWNER, ...changes })),
      Story.then(ref, new ComputerSnapshotCreated({ ownerEmail: OWNER, ...changes })),
      Story.state(ref, { _tag: "Present", ...changes }),
    ),
  ));

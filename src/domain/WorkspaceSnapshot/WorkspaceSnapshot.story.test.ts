import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { MyAx } from "../MyAx.model";
import { WorkspaceSnapshot } from "./WorkspaceSnapshot.aggregate";
import { CreateWorkspaceSnapshot, WorkspaceSnapshotCreated } from "./CreateWorkspaceSnapshot.command";
import { DeleteWorkspaceSnapshot, WorkspaceSnapshotDeleted } from "./DeleteWorkspaceSnapshot.command";
import { UpdateWorkspaceSnapshot, WorkspaceSnapshotUpdated } from "./UpdateWorkspaceSnapshot.command";
import { WorkspaceSnapshotAlreadyExists, WorkspaceSnapshotNotFound } from "./WorkspaceSnapshotRejections.rejection";

const story = Story.make(MyAx);
const ref = WorkspaceSnapshot.ref("x1");
const OWNER = "owner@example.com";
const fields = { backupId: "sample", snapshotVersion: 1, sizeBytes: null };
const changes = { backupId: "changed", snapshotVersion: 2, sizeBytes: 3 };
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

test("the model with WorkspaceSnapshot is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("create, update and delete a workspace snapshot", () =>
  run(
    story(
      Story.when(ref, new CreateWorkspaceSnapshot({ ownerEmail: OWNER, ...fields })),
      Story.then(ref, new WorkspaceSnapshotCreated({ ownerEmail: OWNER, ...fields })),
      Story.state(ref, { _tag: "Present", ...fields }),
      Story.when(ref, new UpdateWorkspaceSnapshot(changes)),
      Story.then(ref, new WorkspaceSnapshotUpdated(changes)),
      Story.state(ref, { _tag: "Present", ownerEmail: OWNER, ...changes }),
      Story.when(ref, new DeleteWorkspaceSnapshot()),
      Story.then(ref, new WorkspaceSnapshotDeleted()),
      Story.state(ref, { _tag: "Deleted" }),
    ),
  ));

test("a workspace snapshot cannot be created twice", () =>
  run(
    story(
      Story.given(ref, new WorkspaceSnapshotCreated({ ownerEmail: OWNER, ...fields })),
      Story.when(ref, new CreateWorkspaceSnapshot({ ownerEmail: OWNER, ...fields })),
      Story.rejected(new WorkspaceSnapshotAlreadyExists()),
    ),
  ));

test("a workspace snapshot that does not exist cannot be updated or deleted", () =>
  run(
    story(
      Story.when(ref, new UpdateWorkspaceSnapshot(changes)),
      Story.rejected(new WorkspaceSnapshotNotFound()),
      Story.when(ref, new DeleteWorkspaceSnapshot()),
      Story.rejected(new WorkspaceSnapshotNotFound()),
    ),
  ));

test("a deleted workspace snapshot cannot be updated or deleted again, but can be created fresh", () =>
  run(
    story(
      Story.given(ref, new WorkspaceSnapshotCreated({ ownerEmail: OWNER, ...fields }), new WorkspaceSnapshotDeleted()),
      Story.when(ref, new UpdateWorkspaceSnapshot(changes)),
      Story.rejected(new WorkspaceSnapshotNotFound()),
      Story.when(ref, new DeleteWorkspaceSnapshot()),
      Story.rejected(new WorkspaceSnapshotNotFound()),
      Story.when(ref, new CreateWorkspaceSnapshot({ ownerEmail: OWNER, ...changes })),
      Story.then(ref, new WorkspaceSnapshotCreated({ ownerEmail: OWNER, ...changes })),
      Story.state(ref, { _tag: "Present", ...changes }),
    ),
  ));

import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { MyAx } from "../MyAx.model";
import { Skill } from "./Skill.aggregate";
import { CreateSkill, SkillCreated } from "./CreateSkill.command";
import { DeleteSkill, SkillDeleted } from "./DeleteSkill.command";
import { UpdateSkill, SkillUpdated } from "./UpdateSkill.command";
import { SkillAlreadyExists, SkillNotFound } from "./SkillRejections.rejection";

const story = Story.make(MyAx);
const ref = Skill.ref("x1");
const OWNER = "owner@example.com";
const fields = { name: "sample", description: "sample", instructions: "sample" };
const changes = { name: "changed", description: "changed", instructions: "changed" };
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

test("the model with Skill is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("create, update and delete a skill", () =>
  run(
    story(
      Story.when(ref, new CreateSkill({ ownerEmail: OWNER, ...fields })),
      Story.then(ref, new SkillCreated({ ownerEmail: OWNER, ...fields })),
      Story.state(ref, { _tag: "Present", ...fields }),
      Story.when(ref, new UpdateSkill(changes)),
      Story.then(ref, new SkillUpdated(changes)),
      Story.state(ref, { _tag: "Present", ownerEmail: OWNER, ...changes }),
      Story.when(ref, new DeleteSkill()),
      Story.then(ref, new SkillDeleted()),
      Story.state(ref, { _tag: "Deleted" }),
    ),
  ));

test("a skill cannot be created twice", () =>
  run(
    story(
      Story.given(ref, new SkillCreated({ ownerEmail: OWNER, ...fields })),
      Story.when(ref, new CreateSkill({ ownerEmail: OWNER, ...fields })),
      Story.rejected(new SkillAlreadyExists()),
    ),
  ));

test("a skill that does not exist cannot be updated or deleted", () =>
  run(
    story(
      Story.when(ref, new UpdateSkill(changes)),
      Story.rejected(new SkillNotFound()),
      Story.when(ref, new DeleteSkill()),
      Story.rejected(new SkillNotFound()),
    ),
  ));

test("a deleted skill cannot be updated or deleted again, but can be created fresh", () =>
  run(
    story(
      Story.given(ref, new SkillCreated({ ownerEmail: OWNER, ...fields }), new SkillDeleted()),
      Story.when(ref, new UpdateSkill(changes)),
      Story.rejected(new SkillNotFound()),
      Story.when(ref, new DeleteSkill()),
      Story.rejected(new SkillNotFound()),
      Story.when(ref, new CreateSkill({ ownerEmail: OWNER, ...changes })),
      Story.then(ref, new SkillCreated({ ownerEmail: OWNER, ...changes })),
      Story.state(ref, { _tag: "Present", ...changes }),
    ),
  ));

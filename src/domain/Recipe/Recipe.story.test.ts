import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { nextRecipeStatus, type RecipeStatus, type RecipeStatusEvent } from "../../fsm/recipe-status";
import { MyAx } from "../MyAx.model";
import { Recipe, RECIPE_RULES, type RecipeCommandName, type RecipeStage } from "./Recipe.aggregate";
import { SaveRecipe, RecipeSaved } from "./SaveRecipe.command";
import { RecipeAlreadyExists, RecipeNotFound, RecipeTransitionRefused } from "./RecipeRejections.rejection";
import { ApproveRecipe, RecipeApproved } from "./ApproveRecipe.command";
import * as Commands from "./commands";
import { DeleteRecipe, RecipeDeleted } from "./DeleteRecipe.command";
import { EditRecipe, RecipeEdited } from "./EditRecipe.command";

const story = Story.make(MyAx);
const ref = Recipe.ref("x1");
const OWNER = "owner@example.com";
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

const STAGE_OF: Record<RecipeStatus, RecipeStage> = { pending: "Pending", enabled: "Enabled", disabled: "Disabled" };
const COMMAND_FOR: Record<RecipeStatusEvent, RecipeCommandName> = {
  approved: "ApproveRecipe",
  rejected: "RejectRecipe",
  enabled: "EnableRecipe",
  disabled: "DisableRecipe",
  returned_to_review: "ReturnRecipeToReview",
};

test("the model with Recipe is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("a Recipe is created once, in the stage asked for", () =>
  run(
    story(
      Story.when(ref, new SaveRecipe({ ownerEmail: OWNER, stage: "Pending" })),
      Story.then(ref, new RecipeSaved({ ownerEmail: OWNER, stage: "Pending" })),
      Story.state(ref, { _tag: "Present", stage: "Pending" }),
      Story.when(ref, new SaveRecipe({ ownerEmail: OWNER, stage: "Pending" })),
      Story.rejected(new RecipeAlreadyExists()),
    ),
  ));

test("editing a Recipe keeps its stage, and a deleted Recipe is gone", () =>
  run(
    story(
      Story.given(ref, new RecipeSaved({ ownerEmail: OWNER, stage: "Enabled" })),
      Story.when(ref, new EditRecipe()),
      Story.then(ref, new RecipeEdited()),
      Story.state(ref, { _tag: "Present", stage: "Enabled" }),
      Story.when(ref, new DeleteRecipe()),
      Story.then(ref, new RecipeDeleted()),
      Story.state(ref, { _tag: "Missing" }),
      Story.when(ref, new EditRecipe()),
      Story.rejected(new RecipeNotFound()),
    ),
  ));

test("a missing Recipe cannot be deleted", () =>
  run(story(Story.when(ref, new DeleteRecipe()), Story.rejected(new RecipeNotFound()))));

test("a command on a Recipe that does not exist is refused", () =>
  run(story(Story.when(ref, new ApproveRecipe()), Story.rejected(new RecipeNotFound()))));

test("every fsm event maps to one command with the same from and to", () => {
  assert.equal(Object.keys(COMMAND_FOR).length, Object.keys(RECIPE_RULES).length);
  for (const [event, command] of Object.entries(COMMAND_FOR) as Array<[RecipeStatusEvent, RecipeCommandName]>) {
    for (const status of Object.keys(STAGE_OF) as RecipeStatus[]) {
      const fsmNext = nextRecipeStatus(status, event);
      const rule = RECIPE_RULES[command];
      const domainNext = (rule.from as readonly string[]).includes(STAGE_OF[status]) ? rule.to : null;
      assert.equal(domainNext, fsmNext === null ? null : STAGE_OF[fsmNext], `${status} + ${event}`);
    }
  }
});

test("the Domain aggregate agrees with nextRecipeStatus for every status and event", async () => {
  for (const status of Object.keys(STAGE_OF) as RecipeStatus[]) {
    for (const event of Object.keys(COMMAND_FOR) as RecipeStatusEvent[]) {
      const name = COMMAND_FOR[event];
      const command = new Commands.ALL[name]() as ApproveRecipe;
      const expected = nextRecipeStatus(status, event);
      const given = Story.given(ref, new RecipeSaved({ ownerEmail: OWNER, stage: STAGE_OF[status] }));
      const outcome = expected === null
        ? story(given, Story.when(ref, command), Story.rejected(new RecipeTransitionRefused({ status: STAGE_OF[status], command: name })))
        : story(given, Story.when(ref, command), Story.then(ref, RECIPE_RULES[name].event() as RecipeApproved), Story.state(ref, { stage: STAGE_OF[expected] }));
      await run(outcome).catch((cause) => {
        throw new Error(`${status} + ${event} expected ${expected ?? "refused"}: ${String((cause as Error).message ?? cause).slice(0, 300)}`);
      });
    }
  }
});

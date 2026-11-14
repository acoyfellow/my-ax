import assert from "node:assert/strict";
import { test } from "node:test";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { nextAttentionState, type AttentionState, type AttentionEvent } from "../../fsm/attention-item";
import { MyAx } from "../MyAx.model";
import { Attention, ATTENTION_RULES, type AttentionCommandName, type AttentionStage } from "./Attention.aggregate";
import { RaiseAttention, AttentionRaised } from "./RaiseAttention.command";
import { AttentionAlreadyExists, AttentionNotFound, AttentionTransitionRefused } from "./AttentionRejections.rejection";
import { MarkAttentionSeen, AttentionSeen } from "./MarkAttentionSeen.command";
import * as Commands from "./commands";
import { AttentionDismissed, DismissAttention } from "./DismissAttention.command";

const story = Story.make(MyAx);
const ref = Attention.ref("x1");
const OWNER = "owner@example.com";
const run = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
  await Effect.runPromise(effect as Effect.Effect<unknown, never>);
};

const STAGE_OF: Record<AttentionState, AttentionStage> = { unseen: "Unseen", seen: "Seen" };
const COMMAND_FOR: Record<AttentionEvent, AttentionCommandName> = {
  seen: "MarkAttentionSeen",
};

test("the model with Attention is well defined", () => {
  assert.deepEqual(Domain.verify(MyAx), []);
});

test("a Attention is created once, in the stage asked for", () =>
  run(
    story(
      Story.when(ref, new RaiseAttention({ ownerEmail: OWNER, stage: "Unseen" })),
      Story.then(ref, new AttentionRaised({ ownerEmail: OWNER, stage: "Unseen" })),
      Story.state(ref, { _tag: "Present", stage: "Unseen" }),
      Story.when(ref, new RaiseAttention({ ownerEmail: OWNER, stage: "Unseen" })),
      Story.rejected(new AttentionAlreadyExists()),
    ),
  ));

test("a command on a Attention that does not exist is refused", () =>
  run(story(Story.when(ref, new MarkAttentionSeen()), Story.rejected(new AttentionNotFound()))));

test("an attention item in any stage can be dismissed once, and is gone after", async () => {
  for (const stage of ["Unseen", "Seen"] as const) {
    await run(
      story(
        Story.given(ref, new AttentionRaised({ ownerEmail: OWNER, stage })),
        Story.when(ref, new DismissAttention()),
        Story.then(ref, new AttentionDismissed()),
        Story.state(ref, { _tag: "Missing" }),
        Story.when(ref, new DismissAttention()),
        Story.rejected(new AttentionNotFound()),
      ),
    );
  }
});

test("every fsm event maps to one command with the same from and to", () => {
  assert.equal(Object.keys(COMMAND_FOR).length, Object.keys(ATTENTION_RULES).length);
  for (const [event, command] of Object.entries(COMMAND_FOR) as Array<[AttentionEvent, AttentionCommandName]>) {
    for (const status of Object.keys(STAGE_OF) as AttentionState[]) {
      const fsmNext = nextAttentionState(status, event);
      const rule = ATTENTION_RULES[command];
      const domainNext = (rule.from as readonly string[]).includes(STAGE_OF[status]) ? rule.to : null;
      assert.equal(domainNext, fsmNext === null ? null : STAGE_OF[fsmNext], `${status} + ${event}`);
    }
  }
});

test("the Domain aggregate agrees with nextAttentionState for every status and event", async () => {
  for (const status of Object.keys(STAGE_OF) as AttentionState[]) {
    for (const event of Object.keys(COMMAND_FOR) as AttentionEvent[]) {
      const name = COMMAND_FOR[event];
      const command = new Commands.ALL[name]() as MarkAttentionSeen;
      const expected = nextAttentionState(status, event);
      const given = Story.given(ref, new AttentionRaised({ ownerEmail: OWNER, stage: STAGE_OF[status] }));
      const outcome = expected === null
        ? story(given, Story.when(ref, command), Story.rejected(new AttentionTransitionRefused({ status: STAGE_OF[status], command: name })))
        : story(given, Story.when(ref, command), Story.then(ref, ATTENTION_RULES[name].event() as AttentionSeen), Story.state(ref, { stage: STAGE_OF[expected] }));
      await run(outcome).catch((cause) => {
        throw new Error(`${status} + ${event} expected ${expected ?? "refused"}: ${String((cause as Error).message ?? cause).slice(0, 300)}`);
      });
    }
  }
});

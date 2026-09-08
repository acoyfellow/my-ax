import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import type { GithubPort, TerrariumPort } from "./orchestrate";
import { runTriageEffect, triageLayer } from "./triage-effect";

function terrarium(): TerrariumPort {
  return {
    spawn: async (_task, taskProof) => ({ runId: "unused", taskFingerprint: "unused", nonce: "unused", taskProof }),
    wait: async () => { throw new Error("unused"); },
  };
}

function github(comment: GithubPort["comment"]): GithubPort {
  return {
    labelIssue: async () => {},
    comment,
    openReadyPr: async () => ({ number: 1 }),
  };
}

const input = { title: "question", body: "plain request", author: "owner" };

test("triage Effect stays lazy and posts its board once", async () => {
  const comments: string[] = [];
  const program = runTriageEffect(input).pipe(Effect.provide(triageLayer({
    github: github(async (_number, body) => { comments.push(body); }),
    terrarium: terrarium(),
    model: { modelId: "test-model" },
  })));

  assert.equal(comments.length, 0);
  const steps = await Effect.runPromise(program);
  assert.equal(comments.length, 1);
  assert.ok(steps.some((step) => step.step === "comment"));
  assert.ok(steps.some((step) => step.step === "stop" && step.reason === "no-draft"));
});

test("triage Effect fails when its required board comment is rejected", async () => {
  const program = runTriageEffect(input).pipe(Effect.provide(triageLayer({
    github: github(async () => { throw new Error("comment failed"); }),
    terrarium: terrarium(),
    model: { modelId: "test-model" },
  })));

  await assert.rejects(() => Effect.runPromise(program), /TriageOperationError|comment failed/);
});

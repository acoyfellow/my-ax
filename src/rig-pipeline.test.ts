import assert from "node:assert/strict";
import test from "node:test";
import { RIG_APPROVE, RIG_APPROVAL_EVENT, RIG_IMAGE_EVENT, RigBuildPending, runRigPipeline, type RigEffects, type RigPipelineParams, type RigSteps } from "./rig-pipeline";

const PARAMS: RigPipelineParams = { ownerEmail: "owner@example.com", runId: "rig-1", target: "pr-416", commit: "abc1234", verifyUrl: "https://pr-416.example.dev/" };

function harness(options: { builds?: Array<"success" | "pending" | "failure">; approval?: string; deployOk?: boolean; signedOutStatus?: number }) {
  const builds = [...(options.builds ?? ["success"])];
  const records: string[] = [];
  const deploys: string[] = [];
  const events: Record<string, unknown> = {
    [RIG_IMAGE_EVENT]: { image: "registry/my-ax-computer:voxl-abc1234" },
    [RIG_APPROVAL_EVENT]: { choice: options.approval ?? RIG_APPROVE, via: "push" },
  };
  const steps: RigSteps = {
    async run(_name, stepOptions, work) {
      const limit = stepOptions.retries?.limit ?? 0;
      for (let attempt = 0; ; attempt++) {
        try {
          return await work();
        } catch (error) {
          if (attempt >= limit) throw error;
        }
      }
    },
    async waitFor<T extends Rpc.Serializable<T>>(_name: string, type: string) {
      return events[type] as T;
    },
  };
  const effects: RigEffects = {
    async buildStatus() {
      return builds.length > 1 ? builds.shift()! : builds[0]!;
    },
    async askApproval() {
      return { decisionId: "run-decision-1" };
    },
    async deploy(_params, image) {
      deploys.push(image);
      return { ok: options.deployOk ?? true, detail: "version v1" };
    },
    async verify() {
      return { signedOutStatus: options.signedOutStatus ?? 302 };
    },
    async record(_params, type) {
      records.push(type);
    },
  };
  return { steps, effects, records, deploys };
}

test("an approved run waits out a pending build, deploys the pushed image and proves signed-out access is blocked", async () => {
  const { steps, effects, records, deploys } = harness({ builds: ["pending", "pending", "success"] });
  const outcome = await runRigPipeline(PARAMS, steps, effects);
  assert.deepEqual(outcome, { status: "deployed", image: "registry/my-ax-computer:voxl-abc1234", signedOutStatus: 302 });
  assert.deepEqual(deploys, ["registry/my-ax-computer:voxl-abc1234"]);
  assert.deepEqual(records, ["rig.started", "rig.build.passed", "rig.image.pushed", "rig.approval.requested", "rig.approved", "rig.deployed", "rig.verified"]);
});

test("a rejected approval never deploys", async () => {
  const { steps, effects, records, deploys } = harness({ approval: "Stop" });
  const outcome = await runRigPipeline(PARAMS, steps, effects);
  assert.deepEqual(outcome, { status: "rejected", choice: "Stop", via: "push" });
  assert.deepEqual(deploys, []);
  assert.equal(records.at(-1), "rig.rejected");
});

test("a failed build stops before asking for approval", async () => {
  const { steps, effects, records, deploys } = harness({ builds: ["failure"] });
  const outcome = await runRigPipeline(PARAMS, steps, effects);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.status === "failed" && outcome.step, "build");
  assert.equal(records.includes("rig.approval.requested"), false);
  assert.deepEqual(deploys, []);
});

test("a deploy that leaves the site open to signed-out users fails verification", async () => {
  const { steps, effects, records } = harness({ signedOutStatus: 200 });
  const outcome = await runRigPipeline(PARAMS, steps, effects);
  assert.equal(outcome.status === "failed" && outcome.step, "verify");
  assert.equal(records.at(-1), "rig.failed");
});

test("a build that stays pending past the retry budget throws so the workflow errors", async () => {
  const { steps, effects } = harness({ builds: ["pending"] });
  await assert.rejects(runRigPipeline(PARAMS, steps, effects), RigBuildPending);
});

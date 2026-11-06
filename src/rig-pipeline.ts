export const RIG_IMAGE_EVENT = "image-pushed";
export const RIG_APPROVAL_EVENT = "approval";
export const RIG_APPROVE = "Deploy";
export const RIG_REJECT = "Stop";

export type RigPipelineParams = {
  ownerEmail: string;
  runId: string;
  target: string;
  commit: string;
  verifyUrl?: string;
};

export type RigApproval = { choice: string; via: "push" | "email" | "api" };
export type RigImage = { image: string };

export type RigStepOptions = { retries?: { limit: number; delay: number; backoff?: "constant" | "linear" | "exponential" }; timeout?: number };

export interface RigSteps {
  run<T extends Rpc.Serializable<T>>(name: string, options: RigStepOptions, work: () => Promise<T>): Promise<T>;
  waitFor<T extends Rpc.Serializable<T>>(name: string, type: string, timeoutMs: number): Promise<T>;
}

export interface RigEffects {
  buildStatus(commit: string): Promise<"success" | "pending" | "failure">;
  askApproval(params: RigPipelineParams, image: string): Promise<{ decisionId: string }>;
  deploy(params: RigPipelineParams, image: string): Promise<{ ok: boolean; detail: string }>;
  verify(url: string): Promise<{ signedOutStatus: number }>;
  record(params: RigPipelineParams, type: string, data: Record<string, unknown>): Promise<void>;
}

export type RigOutcome =
  | { status: "deployed"; image: string; signedOutStatus?: number }
  | { status: "rejected"; choice: string; via: RigApproval["via"] }
  | { status: "failed"; step: string; reason: string };

const HOUR_MS = 3_600_000;
export const RIG_IMAGE_TIMEOUT_MS = 2 * HOUR_MS;
export const RIG_APPROVAL_TIMEOUT_MS = 24 * HOUR_MS;

export class RigBuildPending extends Error {}

export function signedOutIsBlocked(status: number): boolean {
  return status === 302 || status === 401 || status === 403;
}

export async function runRigPipeline(params: RigPipelineParams, steps: RigSteps, effects: RigEffects): Promise<RigOutcome> {
  await effects.record(params, "rig.started", { target: params.target, commit: params.commit });

  const build = await steps.run("build", { retries: { limit: 60, delay: 60_000, backoff: "constant" } }, async () => {
    const status = await effects.buildStatus(params.commit);
    if (status === "pending") throw new RigBuildPending(`build for ${params.commit} is still running`);
    return status;
  });
  if (build === "failure") return fail(params, effects, "build", `build failed for ${params.commit}`);
  await effects.record(params, "rig.build.passed", { commit: params.commit });

  const { image } = await steps.waitFor<RigImage>("image", RIG_IMAGE_EVENT, RIG_IMAGE_TIMEOUT_MS);
  await effects.record(params, "rig.image.pushed", { image });

  const asked = await steps.run("ask approval", { retries: { limit: 3, delay: 5_000, backoff: "exponential" } }, () => effects.askApproval(params, image));
  await effects.record(params, "rig.approval.requested", { decisionId: asked.decisionId });
  const approval = await steps.waitFor<RigApproval>("approval", RIG_APPROVAL_EVENT, RIG_APPROVAL_TIMEOUT_MS);
  if (approval.choice !== RIG_APPROVE) {
    await effects.record(params, "rig.rejected", { choice: approval.choice, via: approval.via });
    return { status: "rejected", choice: approval.choice, via: approval.via };
  }
  await effects.record(params, "rig.approved", { via: approval.via });

  const deployed = await steps.run("deploy", { retries: { limit: 4, delay: 30_000, backoff: "exponential" } }, () => effects.deploy(params, image));
  if (!deployed.ok) return fail(params, effects, "deploy", deployed.detail);
  await effects.record(params, "rig.deployed", { image, detail: deployed.detail });

  if (!params.verifyUrl) return { status: "deployed", image };
  const url = params.verifyUrl;
  const checked = await steps.run("verify", { retries: { limit: 5, delay: 10_000, backoff: "exponential" } }, () => effects.verify(url));
  if (!signedOutIsBlocked(checked.signedOutStatus)) {
    return fail(params, effects, "verify", `signed-out request got ${checked.signedOutStatus}, want 302/401/403`);
  }
  await effects.record(params, "rig.verified", { url, signedOutStatus: checked.signedOutStatus });
  return { status: "deployed", image, signedOutStatus: checked.signedOutStatus };
}

async function fail(params: RigPipelineParams, effects: RigEffects, step: string, reason: string): Promise<RigOutcome> {
  await effects.record(params, "rig.failed", { step, reason });
  return { status: "failed", step, reason };
}

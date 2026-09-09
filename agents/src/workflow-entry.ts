import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { Effect } from "effect";
import { executeAuditWorkflow, executeDigWorkflow, executeTriageWorkflow, type AgentsEnv } from "./workflows";
import type { IssueInput, PullInput } from "./policy";
import { liveGithubPort, liveTerrariumPort } from "./ports";
import {
  closeReviewEffect,
  commentReviewEffect,
  requestReviewChangesEffect,
  reviewGithubLayer,
  reviewReceiptEffect,
} from "./review-effect";
import { requireGateway } from "./policy";

export class TriageWorkflow extends WorkflowEntrypoint<AgentsEnv, IssueInput> {
  async run(event: WorkflowEvent<IssueInput>, step: WorkflowStep) {
    const ports = { github: liveGithubPort(this.env), terrarium: liveTerrariumPort(this.env) };
    return step.do("triage", () => Effect.runPromise(executeTriageWorkflow(this.env, event.payload, ports)));
  }
}

export class AuditWorkflow extends WorkflowEntrypoint<AgentsEnv, PullInput> {
  async run(event: WorkflowEvent<PullInput>, step: WorkflowStep) {
    const github = liveGithubPort(this.env);
    const payload = event.payload;
    const files = payload.number && github.listPullFiles
      ? await step.do("files", () => github.listPullFiles!(payload.number!))
      : [];
    const behindMain = payload.headSha && github.commitsBehindMain
      ? await step.do("behind", () => github.commitsBehindMain!(payload.headSha))
      : -1;
    return step.do("audit", () => Effect.runPromise(executeAuditWorkflow(this.env, { ...payload, files, behindMain }, {
      github,
      promptDigest: "agents/audit@live",
    })));
  }
}

export class ReviewWorkflow extends WorkflowEntrypoint<AgentsEnv, PullInput & { head?: string }> {
  async run(event: WorkflowEvent<PullInput & { head?: string }>, step: WorkflowStep) {
    const github = liveGithubPort(this.env);
    const layer = reviewGithubLayer(github);
    const receipt = await step.do("review-verdict", () => Effect.runPromise(
      Effect.sync(() => requireGateway(this.env)).pipe(Effect.flatMap(() => reviewReceiptEffect(event.payload))),
    ));
    if (receipt.decision === "ignore") return receipt;
    const number = event.payload.number ?? 0;
    await step.do("review-comment", () => Effect.runPromise(
      commentReviewEffect(number, receipt).pipe(Effect.provide(layer), Effect.as(true)),
    ));
    if (receipt.decision === "close" && github.closePr) {
      await step.do("review-close", () => Effect.runPromise(
        closeReviewEffect(number).pipe(Effect.provide(layer), Effect.as(true)),
      ));
    }
    if (receipt.decision === "request-changes" && github.requestChanges) {
      await step.do("review-request-changes", () => Effect.runPromise(
        requestReviewChangesEffect(number, receipt).pipe(Effect.provide(layer), Effect.as(true)),
      ));
    }
    return receipt;
  }
}

export class DigWorkflow extends WorkflowEntrypoint<AgentsEnv, IssueInput> {
  async run(event: WorkflowEvent<IssueInput>, step: WorkflowStep) {
    const ports = { github: liveGithubPort(this.env), terrarium: liveTerrariumPort(this.env) };
    return step.do("dig", () => Effect.runPromise(executeDigWorkflow(this.env, event.payload, ports)));
  }
}

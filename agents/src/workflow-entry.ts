import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { executeAuditWorkflow, executeDigWorkflow, executeReviewWorkflow, executeTriageWorkflow, type AgentsEnv } from "./workflows";
import type { IssueInput, PullInput } from "./policy";
import { liveGithubPort, liveTerrariumPort } from "./ports";
import { formatReviewComment, reviewPull } from "./review";
import { requireGateway } from "./policy";

export class TriageWorkflow extends WorkflowEntrypoint<AgentsEnv, IssueInput> {
  async run(event: WorkflowEvent<IssueInput>, step: WorkflowStep) {
    const ports = { github: liveGithubPort(this.env), terrarium: liveTerrariumPort(this.env) };
    return step.do("triage", () => executeTriageWorkflow(this.env, event.payload, ports));
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
    return step.do("audit", () => executeAuditWorkflow(this.env, { ...payload, files, behindMain }, {
      github,
      promptDigest: "agents/audit@live",
    }));
  }
}

export class ReviewWorkflow extends WorkflowEntrypoint<AgentsEnv, PullInput & { head?: string }> {
  async run(event: WorkflowEvent<PullInput & { head?: string }>, step: WorkflowStep) {
    const github = liveGithubPort(this.env);
    requireGateway(this.env);
    const receipt = await step.do("review-verdict", async () => reviewPull(event.payload));
    if (receipt.decision === "ignore") return receipt;
    await step.do("review-comment", async () => {
      await github.comment(event.payload.number ?? 0, formatReviewComment(receipt));
      return true;
    });
    if (receipt.decision === "close" && github.closePr) {
      await step.do("review-close", async () => {
        await github.closePr!(event.payload.number ?? 0);
        return true;
      });
    }
    if (receipt.decision === "request-changes" && github.requestChanges) {
      await step.do("review-request-changes", async () => {
        await github.requestChanges!(event.payload.number ?? 0, formatReviewComment(receipt)).catch((error) => {
          console.warn("review_request_changes_skipped", {
            number: event.payload.number,
            err: error instanceof Error ? error.message : String(error),
          });
        });
        return true;
      });
    }
    return receipt;
  }
}

export class DigWorkflow extends WorkflowEntrypoint<AgentsEnv, IssueInput> {
  async run(event: WorkflowEvent<IssueInput>, step: WorkflowStep) {
    const ports = { github: liveGithubPort(this.env), terrarium: liveTerrariumPort(this.env) };
    return step.do("dig", () => executeDigWorkflow(this.env, event.payload, ports));
  }
}

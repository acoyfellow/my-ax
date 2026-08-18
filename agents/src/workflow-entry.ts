import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { executeAuditWorkflow, executeDigWorkflow, executeTriageWorkflow, type AgentsEnv } from "./workflows";
import type { IssueInput, PullInput } from "./policy";
import { liveGithubPort, liveTerrariumPort } from "./ports";

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

export class DigWorkflow extends WorkflowEntrypoint<AgentsEnv, IssueInput> {
  async run(event: WorkflowEvent<IssueInput>, step: WorkflowStep) {
    const ports = { github: liveGithubPort(this.env), terrarium: liveTerrariumPort(this.env) };
    return step.do("dig", () => executeDigWorkflow(this.env, event.payload, ports));
  }
}

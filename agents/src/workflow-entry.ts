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
    return step.do("audit", () => executeAuditWorkflow(this.env, event.payload, {
      github: liveGithubPort(this.env),
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

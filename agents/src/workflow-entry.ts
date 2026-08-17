import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { executeAuditWorkflow, executeDigWorkflow, executeTriageWorkflow, type AgentsEnv } from "./workflows";
import type { IssueInput, PullInput } from "./policy";
import type { GithubPort, TerrariumPort } from "./orchestrate";

export class TriageWorkflow extends WorkflowEntrypoint<AgentsEnv, IssueInput> {
  async run(event: WorkflowEvent<IssueInput>, step: WorkflowStep) {
    const ports = stubPorts();
    return step.do("triage", () => executeTriageWorkflow(this.env, event.payload, ports));
  }
}

export class AuditWorkflow extends WorkflowEntrypoint<AgentsEnv, PullInput> {
  async run(event: WorkflowEvent<PullInput>, step: WorkflowStep) {
    const ports = stubPorts();
    return step.do("audit", () => executeAuditWorkflow(this.env, event.payload, { github: ports.github, promptDigest: "agents/audit@local" }));
  }
}

export class DigWorkflow extends WorkflowEntrypoint<AgentsEnv, IssueInput> {
  async run(event: WorkflowEvent<IssueInput>, step: WorkflowStep) {
    const ports = stubPorts();
    return step.do("dig", () => executeDigWorkflow(this.env, event.payload, ports));
  }
}

function stubPorts(): { github: GithubPort; terrarium: TerrariumPort } {
  return {
    github: {
      async labelIssue() {},
      async comment() {},
      async openDraftPr() { return { number: 0 }; },
      async mergePr() { throw new Error("forbidden GitHub action: merge"); },
      async approvePr() { throw new Error("forbidden GitHub action: approve"); },
    },
    terrarium: {
      async spawn() { return { runId: "run", taskFingerprint: "fp", nonce: "n" }; },
      async wait() { return { runId: "run", taskFingerprint: "fp", nonce: "n", ok: true, taskContractStatus: "proven" }; },
    },
  };
}

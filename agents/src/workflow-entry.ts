import { executeAuditWorkflow, executeDigWorkflow, executeTriageWorkflow, type AgentsEnv } from "./workflows";
import type { IssueInput, PullInput } from "./policy";
import type { GithubPort, TerrariumPort } from "./orchestrate";

type Step = { do<T>(name: string, fn: () => Promise<T> | T): Promise<T> };

export class TriageWorkflow {
  async run(event: { payload: IssueInput }, step: Step, env: AgentsEnv) {
    const ports = stubPorts();
    return step.do("triage", () => executeTriageWorkflow(env, event.payload, ports));
  }
}

export class AuditWorkflow {
  async run(event: { payload: PullInput }, step: Step, env: AgentsEnv) {
    const ports = stubPorts();
    return step.do("audit", () => executeAuditWorkflow(env, event.payload, { github: ports.github, promptDigest: "agents/audit@local" }));
  }
}

export class DigWorkflow {
  async run(event: { payload: IssueInput }, step: Step, env: AgentsEnv) {
    const ports = stubPorts();
    return step.do("dig", () => executeDigWorkflow(env, event.payload, ports));
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

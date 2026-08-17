import {
  type AuditReceipt,
  type Classification,
  type IssueInput,
  type PullInput,
  type TerrariumReceipt,
  auditPull,
  acceptVisualProof,
  classifyIssue,
  shouldOpenDraft,
  shouldSpawnDig,
  verifyTerrariumReceipt,
} from "./policy";

export interface GithubPort {
  labelIssue(number: number, labels: string[]): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  openDraftPr(input: { title: string; body: string; head: string }): Promise<{ number: number }>;
  mergePr(number: number): Promise<void>;
  approvePr(number: number): Promise<void>;
}

export interface TerrariumPort {
  spawn(task: string): Promise<{ runId: string; taskFingerprint: string; nonce: string }>;
  wait(runId: string): Promise<TerrariumReceipt>;
}

export interface ModelPort {
  modelId: string;
  classify?(input: IssueInput): Promise<Classification>;
}

export type TriageStep =
  | { step: "classify"; classification: Classification }
  | { step: "label"; labels: string[] }
  | { step: "comment" }
  | { step: "draft"; number: number }
  | { step: "dig"; runId: string; verified: boolean }
  | { step: "visual"; accepted: boolean }
  | { step: "stop"; reason: string };

export async function runTriage(input: IssueInput, ports: { github: GithubPort; terrarium: TerrariumPort; model: ModelPort }): Promise<TriageStep[]> {
  const classification = ports.model.classify ? await ports.model.classify(input) : classifyIssue(input);
  const steps: TriageStep[] = [{ step: "classify", classification }];
  const issueNumber = input.number ?? 0;
  await ports.github.labelIssue(issueNumber, classification.labels);
  steps.push({ step: "label", labels: classification.labels });
  await ports.github.comment(issueNumber, `${classification.summary}\nmodel=${ports.model.modelId}`);
  steps.push({ step: "comment" });
  if (shouldSpawnDig(classification)) {
    const contract = await ports.terrarium.spawn(`Hard issue: ${input.title}\n${input.body}`);
    const receipt = await ports.terrarium.wait(contract.runId);
    const verified = verifyTerrariumReceipt(contract, receipt);
    steps.push({ step: "dig", runId: contract.runId, verified });
    if (!verified) {
      steps.push({ step: "stop", reason: "terrarium receipt unproven" });
      return steps;
    }
    const visualOk = acceptVisualProof(classification.visual, receipt.visual);
    steps.push({ step: "visual", accepted: visualOk });
    if (!visualOk) {
      steps.push({ step: "stop", reason: "visual proof missing" });
      return steps;
    }
    return steps;
  }
  if (shouldOpenDraft(classification)) {
    const pr = await ports.github.openDraftPr({
      title: `bot: ${input.title}`,
      body: "Machine draft. Not reviewed. Human merge only.",
      head: "bot/issue-draft",
    });
    steps.push({ step: "draft", number: pr.number });
    return steps;
  }
  steps.push({ step: "stop", reason: classification.spray ? "spray" : "no-draft" });
  return steps;
}

export async function runAudit(input: PullInput, ports: { github: GithubPort; promptDigest: string }): Promise<AuditReceipt> {
  const receipt = auditPull(input, ports.promptDigest);
  await ports.github.comment(input.number ?? 0, formatAuditComment(receipt));
  return receipt;
}

export function formatAuditComment(receipt: AuditReceipt): string {
  return [
    `## audit receipt`,
    `head: \`${receipt.headSha}\``,
    `prompt: \`${receipt.promptDigest}\``,
    `recommend: ${receipt.recommendation}`,
    `neverApprove: true`,
    `neverMerge: true`,
    ...receipt.findings.map((f) => `- ${f}`),
  ].join("\n");
}

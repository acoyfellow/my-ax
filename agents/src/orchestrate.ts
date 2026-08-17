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

export const PROOF_COMMAND = "npx tsx --test src/desk-board.test.ts agents/src/policy.test.ts agents/src/harness.test.ts agents/src/github-hmac.test.ts";

export interface GithubPort {
  labelIssue(number: number, labels: string[]): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  openReadyPr(input: { title: string; body: string; head: string }): Promise<{ number: number }>;
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
  | { step: "pr"; number: number }
  | { step: "dig"; runId: string; verified: boolean }
  | { step: "visual"; accepted: boolean }
  | { step: "stop"; reason: string };

export async function runTriage(input: IssueInput, ports: { github: GithubPort; terrarium: TerrariumPort; model: ModelPort }): Promise<TriageStep[]> {
  const classification = ports.model.classify ? await ports.model.classify(input) : classifyIssue(input);
  const steps: TriageStep[] = [{ step: "classify", classification }];
  const issueNumber = input.number ?? 0;
  await ports.github.comment(issueNumber, `${classification.summary}\nmodel=${ports.model.modelId}`);
  steps.push({ step: "comment" });
  try {
    await ports.github.labelIssue(issueNumber, classification.labels);
    steps.push({ step: "label", labels: classification.labels });
  } catch {
    steps.push({ step: "stop", reason: "label failed; comment posted" });
  }
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
    if (!input.number) {
      steps.push({ step: "stop", reason: "issue number required before opening a PR" });
      return steps;
    }
    const pr = await ports.github.openReadyPr({
      title: formatReadyPrTitle(input),
      body: formatReadyPrBody(input, classification),
      head: `bot/issue-${input.number}`,
    });
    steps.push({ step: "pr", number: pr.number });
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

export function formatReadyPrTitle(input: IssueInput): string {
  return input.title.replace(/^bug:\s*/i, "fix: ").slice(0, 120);
}

export function formatReadyPrBody(input: IssueInput, classification: Classification): string {
  if (!input.number) throw new Error("issue number required before opening a PR");
  return [
    `Closes #${input.number}`,
    "",
    "## Why",
    classification.summary,
    "",
    "## Receipt",
    `- issue: https://github.com/acoyfellow/my-ax/issues/${input.number}`,
    `- kind: ${classification.kind}`,
    `- severity: ${classification.severity}`,
    `- labels: ${classification.labels.join(", ") || "none"}`,
    `- visual: ${classification.visual}`,
    "",
    "## Files",
    "See the Files changed tab on this PR. This body does not invent a file list.",
    "",
    "## Proof",
    "```sh",
    PROOF_COMMAND,
    "```",
    "",
    "Worker never merges. Worker never approves. Human merge only.",
  ].join("\n");
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

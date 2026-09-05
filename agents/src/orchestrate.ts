import { assertPublicText } from "./public-text";
import {
  type AuditReceipt,
  type Classification,
  type IssueInput,
  type PullInput,
  type TerrariumReceipt,
} from "./policy";

export const PROOF_COMMAND = "npx tsx --test src/desk-board.test.ts agents/src/policy.test.ts agents/src/harness.test.ts agents/src/github-hmac.test.ts";

export interface GithubPort {
  labelIssue(number: number, labels: string[]): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  listComments?(number: number): Promise<string[]>;
  openReadyPr(input: { title: string; body: string; head: string }): Promise<{ number: number }>;
  listPullFiles?(number: number): Promise<string[]>;
  commitsBehindMain?(headSha: string): Promise<number>;
  hasBranch?(name: string): Promise<boolean>;
  hasOpenPrForHead?(head: string): Promise<boolean>;
  findOpenPrForHead?(head: string): Promise<{ number: number; files: string[] } | null>;
  findOpenPrForIssue?(number: number): Promise<{ number: number; files: string[] } | null>;
  createBranch?(name: string, seed?: { path: string; message: string; content: string }): Promise<void>;
  putFile?(head: string, file: { path: string; message: string; content: string }): Promise<void>;
  listBranchFiles?(head: string): Promise<string[]>;
  closePr?(number: number): Promise<void>;
  requestChanges?(number: number, body: string): Promise<void>;
  listOpenIssues?(): Promise<Array<{ number: number; title: string; body: string; author: string; labels?: string[] }>>;
  closeIssue?(number: number, body?: string): Promise<void>;
}

export interface TerrariumPort {
  spawn(task: string, taskProof: string): Promise<{ runId: string; taskFingerprint: string; nonce: string; taskProof: string }>;
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
  | { step: "issue-closed"; number: number }
  | { step: "branch"; head: string }
  | { step: "dig"; runId: string; verified: boolean }
  | { step: "visual"; accepted: boolean }
  | { step: "stop"; reason: string };

export function productFilesOnBranch(files: string[]): string[] {
  return files.filter((file) => file.length > 0 && !file.startsWith(".factory/") && !file.startsWith("src/factory/"));
}

export function formatBranchSeed(input: IssueInput, classification: Classification): string {
  const issueNumber = input.number ?? 0;
  return [
    `# Work branch for issue #${issueNumber}`,
    "",
    `title: ${input.title}`,
    `kind: ${classification.kind}`,
    `severity: ${classification.severity}`,
    "",
    "The factory opened this branch so the pull request has a commit to carry.",
    "Replace this file with the fix, then push to this branch.",
    "",
    `proof: ${PROOF_COMMAND}`,
    "",
    "A human merges. The Worker never merges and never approves.",
    "",
  ].join("\n");
}

export function formatLoopBoard(input: {
  issueNumber: number;
  classification: Classification;
  modelId: string;
  stage: "labeled" | "blocked-missing-branch" | "blocked-stamp" | "pr-opened" | "pr-failed";
  prNumber?: number;
  error?: string;
}): string {
  const issue = `https://github.com/acoyfellow/my-ax/issues/${input.issueNumber}`;
  const head = `bot/issue-${input.issueNumber}`;
  const lines = [
    "## loop board",
    `issue: ${issue}`,
    `stage: ${input.stage}`,
    `kind: ${input.classification.kind}`,
    `labels: ${input.classification.labels.join(", ") || "none"}`,
    `head: ${head}`,
    `model: ${input.modelId}`,
  ];
  if (input.prNumber) lines.push(`pr: https://github.com/acoyfellow/my-ax/pull/${input.prNumber}`);
  if (input.stage === "blocked-missing-branch") {
    lines.push(`blocked: missing ${head}. Sweep keeps the issue open until that head exists.`);
  }
  if (input.stage === "blocked-stamp") {
    lines.push(`blocked: ${head} has no product files. A .factory seed is not a ready PR.`);
  }
  if (input.stage === "labeled" && !input.classification.draft) {
    lines.push("next: a human opts this in. Add the draft label on a new comment. Worker never merges.");
  }
  if (input.error) lines.push(`error: ${input.error}`);
  return lines.join("\n");
}

export function formatReadyPrTitle(input: IssueInput): string {
  return input.title.replace(/^(bug|perf|test):\s*/i, "fix: ").slice(0, 120);
}

export function formatReadyPrBody(input: IssueInput, classification: Classification): string {
  if (!input.number) throw new Error("issue number required before opening a PR");
  return assertPublicText([
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
  ].join("\n"));
}

export function formatAuditComment(receipt: AuditReceipt): string {
  return assertPublicText([
    `## audit receipt`,
    `head: \`${receipt.headSha}\``,
    `prompt: \`${receipt.promptDigest}\``,
    `recommend: ${receipt.recommendation}`,
    `neverApprove: true`,
    `neverMerge: true`,
    ...receipt.findings.map((f) => `- ${f}`),
  ].join("\n"));
}

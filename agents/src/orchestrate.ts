import { assertPublicText } from "./public-text";
import type { Effect } from "effect";
import type { ImplementationModelError } from "./model-implementation-program";
import type { AuditReceipt, Classification, IssueInput, TerrariumReceipt } from "./policy";

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
  createBranchFrom?(name: string, source: string): Promise<void>;
  branchSha?(name: string): Promise<string>;
  promoteBranch?(target: string, source: string): Promise<void>;
  deleteBranch?(name: string): Promise<void>;
  putFile?(head: string, file: { path: string; message: string; content: string }): Promise<void>;
  commitFiles?(head: string, input: { message: string; files: Array<{ path: string; content: string }> }): Promise<{ sha: string }>;
  removeFiles?(head: string, input: { message: string; paths: string[] }): Promise<{ sha: string }>;
  listBranchFiles?(head: string): Promise<string[]>;
  listRepositoryFiles?(): Promise<string[]>;
  readRepositoryFile?(path: string): Promise<string>;
  closePr?(number: number): Promise<void>;
  requestChanges?(number: number, body: string): Promise<void>;
  listOpenIssues?(): Promise<Array<{ number: number; title: string; body: string; author: string; labels?: string[] }>>;
  closeIssue?(number: number, body?: string): Promise<void>;
  reopenIssue?(number: number): Promise<void>;
}

export interface TerrariumPort {
  spawn(task: string, taskProof: string): Promise<{ runId: string; taskFingerprint: string; nonce: string; taskProof: string }>;
  implement?(input: IssueInput & { head: string; submissionHead: string; submissionNonce: string }, taskProof: string): Promise<{ runId: string; taskFingerprint: string; nonce: string; taskProof: string }>;
  wait(runId: string): Promise<TerrariumReceipt>;
}

export interface ModelPort {
  modelId: string;
  classify?(input: IssueInput): Promise<Classification>;
  implement?(input: IssueInput, repository: { paths: string[]; read(path: string): Promise<string> }): Effect.Effect<Array<{ path: string; content: string }>, ImplementationModelError>;
}

export type TriageStep =
  | { step: "classify"; classification: Classification }
  | { step: "label"; labels: string[] }
  | { step: "comment" }
  | { step: "pr"; number: number }
  | { step: "issue-closed"; number: number }
  | { step: "branch"; head: string }
  | { step: "dig"; runId: string; verified: boolean }
  | { step: "implementation"; runId: string; verified: boolean }
  | { step: "visual"; accepted: boolean }
  | { step: "stop"; reason: string };

export function productFilesOnBranch(files: string[]): string[] {
  return files.filter((file) => file.length > 0 && !file.startsWith(".factory/") && !file.startsWith("src/factory/"));
}

export function formatBranchSeed(input: IssueInput, classification: Classification): string {
  return [
    `# Work branch for issue #${input.number ?? 0}`, "",
    `title: ${input.title}`, `kind: ${classification.kind}`, `severity: ${classification.severity}`, "",
    "The factory opened this branch so the pull request has a commit to carry.",
    "Replace this file with the fix, then push to this branch.", "",
    `proof: ${PROOF_COMMAND}`, "", "A human merges. The Worker never merges and never approves.", "",
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
  const decision = input.stage === "pr-opened"
    ? "Review the product change."
    : input.stage === "labeled" && !input.classification.draft
      ? "A person must decide whether to start implementation."
      : "Start or continue product implementation.";
  const result = input.stage === "pr-opened"
    ? `The factory opened pull request #${input.prNumber}.`
    : input.stage === "blocked-missing-branch"
      ? "The issue stays open because its work branch is missing."
      : input.stage === "blocked-stamp"
        ? "The issue stays open because no verified product change exists."
        : input.stage === "pr-failed"
          ? "The issue stays open because the pull request could not be opened."
          : "The issue stays open. No pull request was opened.";
  const lines = [
    "## Factory status", "", "### Decision", decision, "", "### Evidence",
    `- Issue: https://github.com/acoyfellow/my-ax/issues/${input.issueNumber}`,
    `- Work branch: bot/issue-${input.issueNumber}`,
    `- Classification: ${input.classification.kind}`,
    input.error ? `- Last error: ${input.error}` : "- No error was reported.",
    "", "### Result", result, "",
    `<!-- stage: ${input.stage} -->`, `<!-- model: ${input.modelId} -->`,
    `<!-- labels: ${input.classification.labels.join(", ") || "none"} -->`,
  ];
  if (input.prNumber) lines.push(`<!-- pr: https://github.com/acoyfellow/my-ax/pull/${input.prNumber} -->`);
  return lines.join("\n");
}

export function formatReadyPrTitle(input: IssueInput): string {
  return input.title.replace(/^(bug|perf|test):\s*/i, "fix: ").slice(0, 120);
}

export function formatReadyPrBody(input: IssueInput, classification: Classification): string {
  if (!input.number) throw new Error("issue number required before opening a PR");
  return assertPublicText([
    `Closes #${input.number}`, "", "## Why", classification.summary, "", "## Receipt",
    `- issue: https://github.com/acoyfellow/my-ax/issues/${input.number}`,
    `- kind: ${classification.kind}`, `- severity: ${classification.severity}`,
    `- labels: ${classification.labels.join(", ") || "none"}`, `- visual: ${classification.visual}`,
    "", "## Files", "See the Files changed tab on this PR. This body does not invent a file list.",
    "", "## Proof", "```sh", PROOF_COMMAND, "```", "",
    "Worker never merges. Worker never approves. Human merge only.",
  ].join("\n"));
}

export function formatAuditComment(receipt: AuditReceipt): string {
  return assertPublicText([
    "## audit receipt", `head: \`${receipt.headSha}\``, `prompt: \`${receipt.promptDigest}\``,
    `recommend: ${receipt.recommendation}`, "neverApprove: true", "neverMerge: true",
    ...receipt.findings.map((f) => `- ${f}`),
  ].join("\n"));
}

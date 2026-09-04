import { assertPublicText } from "./public-text";
import { formatIssueTransferredToPr } from "./sweep";
import {
  type AuditReceipt,
  type Classification,
  type IssueInput,
  type PullInput,
  type TerrariumReceipt,
  auditPull,
  acceptVisualProof,
  classifyIssue,
  requireTaskProof,
  shouldOpenDraft,
  shouldSpawnDig,
  verifyTerrariumReceipt,
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
  implement?(input: IssueInput, repository: { paths: string[]; read(path: string): Promise<string> }): Promise<Array<{ path: string; content: string }>>;
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
    "## Factory status",
    "",
    "### Decision",
    decision,
    "",
    "### Evidence",
    `- Issue: ${issue}`,
    `- Work branch: ${head}`,
    `- Classification: ${input.classification.kind}`,
    input.error ? `- Last error: ${input.error}` : "- No error was reported.",
    "",
    "### Result",
    result,
    "",
    `<!-- stage: ${input.stage} -->`,
    `<!-- model: ${input.modelId} -->`,
    `<!-- labels: ${input.classification.labels.join(", ") || "none"} -->`,
  ];
  if (input.prNumber) lines.push(`<!-- pr: https://github.com/acoyfellow/my-ax/pull/${input.prNumber} -->`);
  return lines.join("\n");
}

export async function runTriage(input: IssueInput, ports: { github: GithubPort; terrarium: TerrariumPort; model: ModelPort }): Promise<TriageStep[]> {
  const classification = ports.model.classify ? await ports.model.classify(input) : classifyIssue(input);
  const steps: TriageStep[] = [{ step: "classify", classification }];
  const issueNumber = input.number ?? 0;
  let stage: "labeled" | "blocked-missing-branch" | "blocked-stamp" | "pr-opened" | "pr-failed" = "labeled";
  let prNumber: number | undefined;
  let error: string | undefined;
  try {
    await ports.github.labelIssue(issueNumber, classification.labels);
    steps.push({ step: "label", labels: classification.labels });
  } catch {
    steps.push({ step: "stop", reason: "label failed" });
    error = "label failed";
  }
  if (shouldSpawnDig(classification)) {
    const taskProof = requireTaskProof("test -f package.json");
    const contract = await ports.terrarium.spawn(`Hard issue: ${input.title}\n${input.body}`, taskProof);
    const receipt = await ports.terrarium.wait(contract.runId);
    const verified = verifyTerrariumReceipt({ ...contract, taskProof }, receipt);
    steps.push({ step: "dig", runId: contract.runId, verified });
    if (!verified) {
      steps.push({ step: "stop", reason: "terrarium receipt unproven" });
      await ports.github.comment(issueNumber, formatLoopBoard({
        issueNumber, classification, modelId: ports.model.modelId, stage: "labeled", error: "terrarium receipt unproven",
      }));
      steps.push({ step: "comment" });
      return steps;
    }
    const visualOk = acceptVisualProof(classification.visual, receipt.visual);
    steps.push({ step: "visual", accepted: visualOk });
    if (!visualOk) {
      steps.push({ step: "stop", reason: "visual proof missing" });
      await ports.github.comment(issueNumber, formatLoopBoard({
        issueNumber, classification, modelId: ports.model.modelId, stage: "labeled", error: "visual proof missing",
      }));
      steps.push({ step: "comment" });
      return steps;
    }
  } else if (shouldOpenDraft(classification) && issueNumber) {
    const head = `bot/issue-${issueNumber}`;
    let exists = ports.github.hasBranch ? await ports.github.hasBranch(head) : true;
    if (!exists && ports.github.createBranch) {
      try {
        await ports.github.createBranch(head, {
          path: `.factory/issue-${issueNumber}.md`,
          message: `chore: open work branch for issue #${issueNumber}`,
          content: formatBranchSeed(input, classification),
        });
        exists = true;
        steps.push({ step: "branch", head });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    if (!exists) {
      stage = "blocked-missing-branch";
      steps.push({ step: "stop", reason: `missing ${head}` });
    } else {
      let files = ports.github.listBranchFiles ? await ports.github.listBranchFiles(head) : [];
      let product = productFilesOnBranch(files);
      if (
        !product.length
        && ports.model.implement
        && ports.github.listRepositoryFiles
        && ports.github.readRepositoryFile
        && ports.github.createBranchFrom
        && ports.github.commitFiles
        && ports.github.promoteBranch
        && ports.github.deleteBranch
      ) {
        const submissionNonce = crypto.randomUUID().replace(/-/g, "");
        const submissionHead = `factory/model-${issueNumber}-${submissionNonce}`;
        try {
          const paths = await ports.github.listRepositoryFiles();
          const generated = await ports.model.implement(input, {
            paths,
            read: (path) => ports.github.readRepositoryFile!(path),
          });
          await ports.github.createBranchFrom(submissionHead, head);
          await ports.github.commitFiles(submissionHead, {
            message: `fix: implement issue #${issueNumber}`,
            files: generated,
          });
          await ports.github.promoteBranch(head, submissionHead);
          const seedPaths = files.filter((path) => path.startsWith(".factory/") || path.startsWith("src/factory/"));
          if (seedPaths.length && ports.github.removeFiles) {
            await ports.github.removeFiles(head, { message: `chore: remove factory seed for issue #${issueNumber}`, paths: seedPaths });
          }
          product = generated.map((file) => file.path);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        } finally {
          await ports.github.deleteBranch(submissionHead).catch(() => undefined);
        }
      }
      if (
        !product.length
        && !error
        && ports.terrarium.implement
        && ports.github.createBranchFrom
        && ports.github.branchSha
        && ports.github.promoteBranch
        && ports.github.deleteBranch
        && ports.github.listBranchFiles
      ) {
        const submissionNonce = crypto.randomUUID().replace(/-/g, "");
        const submissionHead = `factory/submission-${issueNumber}-${submissionNonce}`;
        const submissionRefUrl = `https://api.github.com/repos/acoyfellow/my-ax/git/ref/heads/${submissionHead.replaceAll("/", "%2F")}`;
        const targetRefUrl = `https://api.github.com/repos/acoyfellow/my-ax/git/ref/heads/${head.replaceAll("/", "%2F")}`;
        const readSha = "/usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)[\"object\"][\"sha\"])'";
        const taskProof = requireTaskProof(`test -f package.json && submitted="$(/usr/bin/curl -fsS ${submissionRefUrl} | ${readSha})" && target="$(/usr/bin/curl -fsS ${targetRefUrl} | ${readSha})" && test -n "$submitted" && test -n "$target" && test "$submitted" != "$target" && tests="$(git diff --name-only origin/main...HEAD -- 'src/*.test.ts' 'src/**/*.test.ts')" && test -n "$tests" && npx tsx --test $tests`);
        let runId = "not-started";
        let verified = false;
        try {
          await ports.github.createBranchFrom(submissionHead, head);
          const initialSubmissionSha = await ports.github.branchSha(submissionHead);
          const contract = await ports.terrarium.implement({ ...input, head, submissionHead, submissionNonce }, taskProof);
          runId = contract.runId;
          const receipt = await ports.terrarium.wait(contract.runId);
          verified = verifyTerrariumReceipt({ ...contract, taskProof }, receipt);
          if (verified) {
            const submittedSha = await ports.github.branchSha(submissionHead);
            if (submittedSha !== initialSubmissionSha) {
              await ports.github.promoteBranch(head, submissionHead);
              const seedPaths = files.filter((path) => path.startsWith(".factory/") || path.startsWith("src/factory/"));
              if (seedPaths.length && ports.github.removeFiles) {
                await ports.github.removeFiles(head, { message: `chore: remove factory seed for issue #${issueNumber}`, paths: seedPaths });
              }
              product = ["verified implementation submission"];
            } else {
              error = "implementation produced no product files";
            }
          } else {
            error = "implementation proof failed";
          }
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        } finally {
          await ports.github.deleteBranch(submissionHead).catch(() => undefined);
          steps.push({ step: "implementation", runId, verified });
        }
      }
      if (!product.length) {
        stage = "blocked-stamp";
        error = error ?? "implementation produced no product files";
        steps.push({ step: "stop", reason: error });
      } else {
        try {
          const pr = await ports.github.openReadyPr({
            title: formatReadyPrTitle(input),
            body: formatReadyPrBody(input, classification),
            head,
          });
          prNumber = pr.number;
          stage = "pr-opened";
          steps.push({ step: "pr", number: pr.number });
          if (ports.github.closeIssue) {
            await ports.github.closeIssue(issueNumber, formatIssueTransferredToPr(pr.number));
            steps.push({ step: "issue-closed", number: issueNumber });
          }
        } catch (err) {
          stage = "pr-failed";
          error = err instanceof Error ? err.message : String(err);
          steps.push({ step: "stop", reason: error });
        }
      }
    }
  } else {
    steps.push({ step: "stop", reason: classification.spray ? "spray" : "no-draft" });
  }
  const board = formatLoopBoard({
    issueNumber, classification, modelId: ports.model.modelId, stage, prNumber, error,
  });
  if (await alreadyPostedBoard(ports.github, issueNumber, board, input.commentsCount)) {
    steps.push({ step: "stop", reason: "board already posted" });
    return steps;
  }
  await ports.github.comment(issueNumber, board);
  steps.push({ step: "comment" });
  return steps;
}

async function alreadyPostedBoard(github: GithubPort, issueNumber: number, board: string, commentsCount?: number): Promise<boolean> {
  if (commentsCount === 0) return false;
  if (!github.listComments) return false;
  const comments = await github.listComments(issueNumber);
  const state = board.match(/^(?:<!--\s*)?stage:\s*([\w-]+)/m)?.[1];
  if (state && comments.some((body) => body.match(/^(?:<!--\s*)?stage:\s*([\w-]+)/m)?.[1] === state)) return true;
  return comments.some((body) => body.trim() === board.trim());
}

export async function runAudit(input: PullInput, ports: { github: GithubPort; promptDigest: string }): Promise<AuditReceipt> {
  const receipt = auditPull(input, ports.promptDigest);
  await ports.github.comment(input.number ?? 0, formatAuditComment(receipt));
  return receipt;
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

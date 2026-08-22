import { assertNoMergeAction, type PullInput } from "./policy";
import { assertPublicText } from "./public-text";
import type { GithubPort } from "./orchestrate";

export const OWNER_LOGINS = ["acoyfellow"] as const;
export const OWNER_HEAD = /^bot\/issue-\d+$/;

export type ReviewDecision = "ignore" | "close" | "request-changes" | "ready-for-owner";

export interface ReviewReceipt {
  decision: ReviewDecision;
  neverApprove: true;
  neverMerge: true;
  findings: string[];
}

export function isOwnerPr(input: { author: string; head?: string }): boolean {
  const author = input.author.trim().toLowerCase();
  if (OWNER_LOGINS.some((login) => login === author)) return true;
  return Boolean(input.head && OWNER_HEAD.test(input.head));
}

export function reviewPull(input: PullInput & { head?: string; proofExit?: number; proofLog?: string }): ReviewReceipt {
  if (!isOwnerPr({ author: input.author, head: input.head })) {
    return { decision: "ignore", neverApprove: true, neverMerge: true, findings: ["not an owner PR"] };
  }
  if (input.draft) {
    return { decision: "ignore", neverApprove: true, neverMerge: true, findings: ["draft; wait"] };
  }
  if (/invalid url string\.?$/i.test(input.title) && /auto error report/i.test(input.body)) {
    return { decision: "close", neverApprove: true, neverMerge: true, findings: ["auto-error flood; close"] };
  }
  if (typeof input.proofExit !== "number") {
    return {
      decision: "request-changes",
      neverApprove: true,
      neverMerge: true,
      findings: ["proof missing; clone the head and run the proof command"],
    };
  }
  if (input.proofExit !== 0) {
    return {
      decision: "request-changes",
      neverApprove: true,
      neverMerge: true,
      findings: [`proof failed (${input.proofExit})`, (input.proofLog || "").slice(0, 400)],
    };
  }
  const log = input.proofLog || "";
  if (!/# pass\b/i.test(log) && !/typecheck/i.test(log)) {
    return {
      decision: "request-changes",
      neverApprove: true,
      neverMerge: true,
      findings: ["proof log has no typecheck or test pass line"],
    };
  }
  return {
    decision: "ready-for-owner",
    neverApprove: true,
    neverMerge: true,
    findings: ["proof passed; owner is the last reviewer"],
  };
}

export function formatReviewComment(receipt: ReviewReceipt): string {
  return assertPublicText([
    "## review receipt",
    `decision: ${receipt.decision}`,
    "neverApprove: true",
    "neverMerge: true",
    ...receipt.findings.filter(Boolean).map((line) => `- ${line}`),
  ].join("\n"));
}

export async function runReview(
  input: PullInput & { head?: string; proofExit?: number; proofLog?: string },
  ports: { github: GithubPort },
): Promise<ReviewReceipt> {
  const receipt = reviewPull(input);
  if (receipt.decision === "ignore") return receipt;
  assertNoMergeAction("comment");
  await ports.github.comment(input.number ?? 0, formatReviewComment(receipt));
  if (receipt.decision === "close") {
    if (!ports.github.closePr) throw new Error("closePr missing");
    await ports.github.closePr(input.number ?? 0);
  }
  if (receipt.decision === "request-changes" && ports.github.requestChanges) {
    await ports.github.requestChanges(input.number ?? 0, formatReviewComment(receipt)).catch((error) => {
      console.warn("review_request_changes_skipped", {
        number: input.number,
        err: error instanceof Error ? error.message : String(error),
      });
    });
  }
  return receipt;
}

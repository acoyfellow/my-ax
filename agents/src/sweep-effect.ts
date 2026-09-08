import { Context, Data, Effect, Layer } from "effect";
import type { GithubPort } from "./orchestrate";
import { formatDuplicateClose, formatIssueTransferredToPr, formatPlaceholderPrClose, formatRetryExhausted, planSweep, sweepLeaseId, type SweepIssue } from "./sweep";

export class SweepOperationError extends Data.TaggedError("SweepOperationError")<{ operation: string; cause?: unknown; message: string }> {}
export class SweepGithub extends Context.Service<SweepGithub, GithubPort>()("my-ax/agents/SweepGithub") {}
export class SweepTriage extends Context.Service<SweepTriage, {
  queue(deliveryId: string, issue: SweepIssue): Effect.Effect<boolean, SweepOperationError>;
}>()("my-ax/agents/SweepTriage") {}

function attempt<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({ try: run, catch: (cause) => new SweepOperationError({ operation, cause, message: `sweep ${operation} failed` }) });
}

export function sweepLayer(ports: { github: GithubPort; queue(deliveryId: string, issue: SweepIssue): Promise<{ ok: boolean }> }) {
  return Layer.mergeAll(
    Layer.succeed(SweepGithub, ports.github),
    Layer.succeed(SweepTriage, { queue: (deliveryId: string, issue: SweepIssue) => attempt("queue", () => ports.queue(deliveryId, issue)).pipe(Effect.map((response) => response.ok)) }),
  );
}

export function runIssueSweepEffect(scheduledTime: number, onlyIssue?: number) {
  return Effect.gen(function* () {
    const github = yield* SweepGithub;
    const triage = yield* SweepTriage;
    if (!github.listOpenIssues || !github.listComments) return yield* Effect.fail(new SweepOperationError({ operation: "configure", message: "Sweep requires issue and comment reads" }));
    const open = yield* attempt("list_issues", () => github.listOpenIssues!());
    const issues: SweepIssue[] = [];
    for (const issue of open) {
      if (onlyIssue !== undefined && issue.number !== onlyIssue) continue;
      const comments = yield* attempt("list_comments", () => github.listComments!(issue.number));
      const head = `bot/issue-${issue.number}`;
      const hasHead = github.hasBranch ? yield* attempt("has_branch", () => github.hasBranch!(head)) : false;
      const [openPr, linkedPr] = yield* Effect.all([
        github.findOpenPrForHead ? attempt("find_head_pr", () => github.findOpenPrForHead!(head)) : Effect.succeed(null),
        github.findOpenPrForIssue ? attempt("find_issue_pr", () => github.findOpenPrForIssue!(issue.number)) : Effect.succeed(null),
      ], { concurrency: 2 });
      const hasOpenPr = openPr ? true : github.hasOpenPrForHead ? yield* attempt("has_open_pr", () => github.hasOpenPrForHead!(head)) : false;
      issues.push({ ...issue, state: "open", comments, hasHead, hasOpenPr, openPr, linkedPr });
    }
    const actions = planSweep(issues, scheduledTime);
    let closed = 0;
    let queued = 0;
    let needsHuman = 0;
    for (const action of actions) {
      if (action.action === "close-duplicate" && github.closeIssue) {
        yield* attempt("close_duplicate", () => github.closeIssue!(action.number, formatDuplicateClose(action.keep, action.fingerprint)));
        closed++;
      }
      if (action.action === "close-issue-to-pr" && github.closeIssue) {
        yield* attempt("transfer_issue", () => github.closeIssue!(action.number, formatIssueTransferredToPr(action.prNumber)));
        closed++;
      }
      if (action.action === "close-placeholder-pr" && github.closePr) {
        yield* attempt("comment_placeholder", () => github.comment(action.prNumber, formatPlaceholderPrClose(action.number)));
        yield* attempt("close_placeholder", () => github.closePr!(action.prNumber));
        yield* attempt("label_issue", () => github.labelIssue(action.number, ["triage:needs-human"]));
        closed++;
        needsHuman++;
      }
      if (action.action === "needs-human") {
        yield* attempt("label_exhausted", () => github.labelIssue(action.number, ["triage:needs-human"]));
        yield* attempt("comment_exhausted", () => github.comment(action.number, formatRetryExhausted(action.attempts)));
        needsHuman++;
      }
      if (action.action === "queue") {
        const issue = issues.find((issue) => issue.number === action.number);
        if (issue && (yield* triage.queue(sweepLeaseId(issue.number, scheduledTime), issue))) queued++;
      }
    }
    return { closed, queued, needsHuman, inspected: issues.map((issue) => issue.number), actions };
  });
}

import { Context, Data, Effect, Layer, Result } from "effect";
import { formatIssueTransferredToPr } from "./sweep";
import {
  type GithubPort,
  type ModelPort,
  type TerrariumPort,
  type TriageStep,
  formatBranchSeed,
  formatLoopBoard,
  formatReadyPrBody,
  formatReadyPrTitle,
  productFilesOnBranch,
} from "./orchestrate";
import {
  acceptVisualProof,
  classifyIssue,
  requireTaskProof,
  shouldOpenDraft,
  shouldSpawnDig,
  verifyTerrariumReceipt,
  type IssueInput,
} from "./policy";

export class TriageOperationError extends Data.TaggedError("TriageOperationError")<{
  operation: string;
  cause: unknown;
}> {}

export class TriageGithub extends Context.Service<TriageGithub, GithubPort>()("my-ax/agents/TriageGithub") {}
export class TriageTerrarium extends Context.Service<TriageTerrarium, TerrariumPort>()("my-ax/agents/TriageTerrarium") {}
export class TriageModel extends Context.Service<TriageModel, ModelPort>()("my-ax/agents/TriageModel") {}

export function triageLayer(ports: { github: GithubPort; terrarium: TerrariumPort; model: ModelPort }) {
  return Layer.mergeAll(
    Layer.succeed(TriageGithub, TriageGithub.of(ports.github)),
    Layer.succeed(TriageTerrarium, TriageTerrarium.of(ports.terrarium)),
    Layer.succeed(TriageModel, TriageModel.of(ports.model)),
  );
}

function attempt<A>(operation: string, run: () => Promise<A>): Effect.Effect<A, TriageOperationError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new TriageOperationError({ operation, cause }),
  });
}

function errorMessage(error: TriageOperationError): string {
  return error.cause instanceof Error ? error.cause.message : String(error.cause);
}

function boardAlreadyPosted(
  github: GithubPort,
  issueNumber: number,
  board: string,
  commentsCount?: number,
): Effect.Effect<boolean, TriageOperationError> {
  if (commentsCount === 0 || !github.listComments) return Effect.succeed(false);
  return attempt("list_comments", () => github.listComments!(issueNumber)).pipe(
    Effect.map((comments) => comments.some((body) => body.trim() === board.trim())),
  );
}

export function runTriageEffect(
  input: IssueInput,
): Effect.Effect<TriageStep[], TriageOperationError, TriageGithub | TriageTerrarium | TriageModel> {
  return Effect.gen(function* () {
    const github = yield* TriageGithub;
    const terrarium = yield* TriageTerrarium;
    const model = yield* TriageModel;
    const classification = model.classify
      ? yield* attempt("classify_issue", () => model.classify!(input))
      : classifyIssue(input);
    const steps: TriageStep[] = [{ step: "classify", classification }];
    const issueNumber = input.number ?? 0;
    let stage: "labeled" | "blocked-missing-branch" | "blocked-stamp" | "pr-opened" | "pr-failed" = "labeled";
    let prNumber: number | undefined;
    let error: string | undefined;

    const labelResult = yield* attempt("label_issue", () => github.labelIssue(issueNumber, classification.labels)).pipe(Effect.result);
    if (Result.isSuccess(labelResult)) {
      steps.push({ step: "label", labels: classification.labels });
    } else {
      steps.push({ step: "stop", reason: "label failed" });
      error = "label failed";
    }

    if (shouldSpawnDig(classification)) {
      const taskProof = requireTaskProof("test -f package.json");
      const contract = yield* attempt("spawn_terrarium", () => terrarium.spawn(`Hard issue: ${input.title}\n${input.body}`, taskProof));
      const receipt = yield* attempt("wait_terrarium", () => terrarium.wait(contract.runId));
      const verified = verifyTerrariumReceipt({ ...contract, taskProof }, receipt);
      steps.push({ step: "dig", runId: contract.runId, verified });
      if (!verified) {
        steps.push({ step: "stop", reason: "terrarium receipt unproven" });
        yield* attempt("comment_unproven_receipt", () => github.comment(issueNumber, formatLoopBoard({
          issueNumber,
          classification,
          modelId: model.modelId,
          stage: "labeled",
          error: "terrarium receipt unproven",
        })));
        steps.push({ step: "comment" });
        return steps;
      }
      const visualOk = acceptVisualProof(classification.visual, receipt.visual);
      steps.push({ step: "visual", accepted: visualOk });
      if (!visualOk) {
        steps.push({ step: "stop", reason: "visual proof missing" });
        yield* attempt("comment_missing_visual", () => github.comment(issueNumber, formatLoopBoard({
          issueNumber,
          classification,
          modelId: model.modelId,
          stage: "labeled",
          error: "visual proof missing",
        })));
        steps.push({ step: "comment" });
        return steps;
      }
    } else if (shouldOpenDraft(classification) && issueNumber) {
      const head = `bot/issue-${issueNumber}`;
      let exists = github.hasBranch ? yield* attempt("has_branch", () => github.hasBranch!(head)) : true;
      if (!exists && github.createBranch) {
        const created = yield* attempt("create_branch", () => github.createBranch!(head, {
          path: `.factory/issue-${issueNumber}.md`,
          message: `chore: open work branch for issue #${issueNumber}`,
          content: formatBranchSeed(input, classification),
        })).pipe(Effect.result);
        if (Result.isSuccess(created)) {
          exists = true;
          steps.push({ step: "branch", head });
        } else {
          error = errorMessage(created.failure);
        }
      }
      if (!exists) {
        stage = "blocked-missing-branch";
        steps.push({ step: "stop", reason: `missing ${head}` });
      } else {
        const files = github.listBranchFiles
          ? yield* attempt("list_branch_files", () => github.listBranchFiles!(head))
          : [];
        const product = productFilesOnBranch(files);
        if (!product.length) {
          stage = "blocked-stamp";
          error = error ?? "product files missing; a .factory seed is not a ready PR. Terrarium is not on this path.";
          steps.push({ step: "stop", reason: error });
        } else {
          const opened = yield* attempt("open_ready_pr", () => github.openReadyPr({
            title: formatReadyPrTitle(input),
            body: formatReadyPrBody(input, classification),
            head,
          })).pipe(Effect.result);
          if (Result.isFailure(opened)) {
            stage = "pr-failed";
            error = errorMessage(opened.failure);
            steps.push({ step: "stop", reason: error });
          } else {
            prNumber = opened.success.number;
            stage = "pr-opened";
            steps.push({ step: "pr", number: prNumber });
            if (github.closeIssue) {
              const closed = yield* attempt("close_issue", () => github.closeIssue!(issueNumber, formatIssueTransferredToPr(prNumber!))).pipe(Effect.result);
              if (Result.isFailure(closed)) {
                stage = "pr-failed";
                error = errorMessage(closed.failure);
                steps.push({ step: "stop", reason: error });
              } else {
                steps.push({ step: "issue-closed", number: issueNumber });
              }
            }
          }
        }
      }
    } else {
      steps.push({ step: "stop", reason: classification.spray ? "spray" : "no-draft" });
    }

    const board = formatLoopBoard({ issueNumber, classification, modelId: model.modelId, stage, prNumber, error });
    if (yield* boardAlreadyPosted(github, issueNumber, board, input.commentsCount)) {
      steps.push({ step: "stop", reason: "board already posted" });
      return steps;
    }
    yield* attempt("comment_loop_board", () => github.comment(issueNumber, board));
    steps.push({ step: "comment" });
    return steps;
  });
}

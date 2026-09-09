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
    Effect.map((comments) => {
      const state = board.match(/^(?:<!--\s*)?stage:\s*([\w-]+)/m)?.[1];
      return comments.some((body) => body.trim() === board.trim() || Boolean(state && body.match(/^(?:<!--\s*)?stage:\s*([\w-]+)/m)?.[1] === state));
    }),
  );
}

function implementBranch(input: IssueInput, head: string, files: string[]) {
  return Effect.gen(function* () {
    const github = yield* TriageGithub;
    const model = yield* TriageModel;
    const terrarium = yield* TriageTerrarium;
    let product = productFilesOnBranch(files);
    let error: string | undefined;
    const steps: TriageStep[] = [];
    const issueNumber = input.number ?? 0;
    const removeSeed = () => {
      const paths = files.filter((path) => path.startsWith(".factory/") || path.startsWith("src/factory/"));
      return paths.length && github.removeFiles
        ? attempt("remove_seed", () => github.removeFiles!(head, { message: `chore: remove factory seed for issue #${issueNumber}`, paths })).pipe(Effect.asVoid)
        : Effect.void;
    };
    const cleanup = (branch: string) => attempt("delete_submission_branch", () => github.deleteBranch!(branch)).pipe(
      Effect.catch(() => Effect.logWarning("temporary implementation branch cleanup failed")),
    );
    if (!product.length && model.implement && github.listRepositoryFiles && github.readRepositoryFile && github.createBranchFrom && github.commitFiles && github.promoteBranch && github.deleteBranch) {
      const nonce = yield* Effect.sync(() => crypto.randomUUID().replace(/-/g, ""));
      const submissionHead = `factory/model-${issueNumber}-${nonce}`;
      let created = false;
      const result = yield* Effect.gen(function* () {
        const paths = yield* attempt("list_repository_files", () => github.listRepositoryFiles!());
        const generated = yield* model.implement!(input, { paths, read: (path) => github.readRepositoryFile!(path) }).pipe(
          Effect.mapError((cause) => new TriageOperationError({ operation: "model_implementation", cause })),
        );
        yield* attempt("create_model_branch", () => github.createBranchFrom!(submissionHead, head));
        created = true;
        yield* attempt("commit_implementation", () => github.commitFiles!(submissionHead, { message: `fix: implement issue #${issueNumber}`, files: generated }));
        yield* attempt("promote_implementation", () => github.promoteBranch!(head, submissionHead));
        yield* removeSeed();
        return generated.map((file) => file.path);
      }).pipe(
        Effect.ensuring(Effect.suspend(() => created ? cleanup(submissionHead) : Effect.void)),
        Effect.result,
      );
      if (Result.isSuccess(result)) product = result.success;
      else error = errorMessage(result.failure);
    }
    if (!product.length && !error && terrarium.implement && github.createBranchFrom && github.branchSha && github.promoteBranch && github.deleteBranch && github.listBranchFiles) {
      const submissionNonce = yield* Effect.sync(() => crypto.randomUUID().replace(/-/g, ""));
      const submissionHead = `factory/submission-${issueNumber}-${submissionNonce}`;
      const submissionRefUrl = `https://api.github.com/repos/acoyfellow/my-ax/git/ref/heads/${submissionHead.replaceAll("/", "%2F")}`;
      const targetRefUrl = `https://api.github.com/repos/acoyfellow/my-ax/git/ref/heads/${head.replaceAll("/", "%2F")}`;
      const readSha = "/usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)[\"object\"][\"sha\"])'";
      const taskProof = requireTaskProof(`test -f package.json && submitted="$(/usr/bin/curl -fsS ${submissionRefUrl} | ${readSha})" && target="$(/usr/bin/curl -fsS ${targetRefUrl} | ${readSha})" && test -n "$submitted" && test -n "$target" && test "$submitted" != "$target" && tests="$(git diff --name-only origin/main...HEAD -- 'src/*.test.ts' 'src/**/*.test.ts')" && test -n "$tests" && npx tsx --test $tests`);
      let runId = "not-started";
      let verified = false;
      let created = false;
      const result = yield* Effect.gen(function* () {
        yield* attempt("create_submission_branch", () => github.createBranchFrom!(submissionHead, head));
        created = true;
        const initialSha = yield* attempt("read_initial_submission_sha", () => github.branchSha!(submissionHead));
        const contract = yield* attempt("start_implementation", () => terrarium.implement!({ ...input, head, submissionHead, submissionNonce }, taskProof));
        runId = contract.runId;
        const receipt = yield* attempt("wait_implementation", () => terrarium.wait(contract.runId));
        verified = verifyTerrariumReceipt({ ...contract, taskProof }, receipt);
        if (!verified) return { product: [] as string[], error: "implementation proof failed" };
        const submittedSha = yield* attempt("read_submission_sha", () => github.branchSha!(submissionHead));
        if (submittedSha === initialSha) return { product: [] as string[], error: "implementation produced no product files" };
        yield* attempt("promote_submission", () => github.promoteBranch!(head, submissionHead));
        yield* removeSeed();
        return { product: ["verified implementation submission"], error: undefined };
      }).pipe(
        Effect.ensuring(Effect.suspend(() => created ? cleanup(submissionHead) : Effect.void)),
        Effect.result,
      );
      steps.push({ step: "implementation", runId, verified });
      if (Result.isSuccess(result)) { product = result.success.product; error = result.success.error; }
      else error = errorMessage(result.failure);
    }
    return { product, error, steps };
  });
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
        const implementation = yield* implementBranch(input, head, files);
        steps.push(...implementation.steps);
        const product = implementation.product;
        error = implementation.error ?? error;
        if (!product.length) {
          stage = "blocked-stamp";
          error = error ?? "implementation produced no product files";
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

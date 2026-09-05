import { Context, Data, Effect, Layer } from "effect";
import type { GithubPort } from "./orchestrate";
import { assertNoMergeAction } from "./policy";
import { formatReviewComment, reviewPull, type ReviewInput, type ReviewReceipt } from "./review";

export type ReviewGithubPort = Pick<GithubPort, "comment" | "closePr" | "requestChanges">;

export class ReviewOperationError extends Data.TaggedError("ReviewOperationError")<{
  operation: "comment" | "close_pr";
  cause: unknown;
}> {}

export class ReviewGithub extends Context.Service<ReviewGithub, ReviewGithubPort>()("my-ax/agents/ReviewGithub") {}

export function reviewGithubLayer(github: ReviewGithubPort): Layer.Layer<ReviewGithub> {
  return Layer.succeed(ReviewGithub, ReviewGithub.of(github));
}

function attempt(
  operation: ReviewOperationError["operation"],
  run: () => Promise<void>,
): Effect.Effect<void, ReviewOperationError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new ReviewOperationError({ operation, cause }),
  });
}

export function reviewReceiptEffect(input: ReviewInput): Effect.Effect<ReviewReceipt> {
  return Effect.sync(() => reviewPull(input));
}

export function commentReviewEffect(
  number: number,
  receipt: ReviewReceipt,
): Effect.Effect<void, ReviewOperationError, ReviewGithub> {
  return Effect.gen(function* () {
    const github = yield* ReviewGithub;
    assertNoMergeAction("comment");
    yield* attempt("comment", () => github.comment(number, formatReviewComment(receipt)));
  });
}

export function closeReviewEffect(number: number): Effect.Effect<void, ReviewOperationError, ReviewGithub> {
  return Effect.gen(function* () {
    const github = yield* ReviewGithub;
    if (!github.closePr) return yield* Effect.fail(new ReviewOperationError({
      operation: "close_pr",
      cause: new Error("closePr missing"),
    }));
    yield* attempt("close_pr", () => github.closePr!(number));
  });
}

export function requestReviewChangesEffect(
  number: number,
  receipt: ReviewReceipt,
): Effect.Effect<void, never, ReviewGithub> {
  return Effect.gen(function* () {
    const github = yield* ReviewGithub;
    if (!github.requestChanges) return;
    yield* Effect.tryPromise({
      try: () => github.requestChanges!(number, formatReviewComment(receipt)),
      catch: (cause) => cause,
    }).pipe(Effect.catch((error) => Effect.sync(() => {
      console.warn("review_request_changes_skipped", {
        number,
        err: error instanceof Error ? error.message : String(error),
      });
    })));
  });
}

export function runReviewEffect(input: ReviewInput): Effect.Effect<ReviewReceipt, ReviewOperationError, ReviewGithub> {
  return Effect.gen(function* () {
    const receipt = yield* reviewReceiptEffect(input);
    if (receipt.decision === "ignore") return receipt;
    const number = input.number ?? 0;
    yield* commentReviewEffect(number, receipt);
    if (receipt.decision === "close") yield* closeReviewEffect(number);
    if (receipt.decision === "request-changes") yield* requestReviewChangesEffect(number, receipt);
    return receipt;
  });
}

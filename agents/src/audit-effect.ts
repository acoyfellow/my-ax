import { Context, Data, Effect, Layer } from "effect";
import { formatAuditComment, type GithubPort } from "./orchestrate";
import { auditPull, type AuditReceipt, type PullInput } from "./policy";

export class AuditCommentError extends Data.TaggedError("AuditCommentError")<{
  pullNumber: number;
  cause: unknown;
}> {}

export class AuditGithub extends Context.Service<AuditGithub, Pick<GithubPort, "comment">>()("my-ax/agents/AuditGithub") {}

export function auditGithubLayer(github: Pick<GithubPort, "comment">): Layer.Layer<AuditGithub> {
  return Layer.succeed(AuditGithub, AuditGithub.of(github));
}

export function runAuditEffect(
  input: PullInput,
  promptDigest: string,
): Effect.Effect<AuditReceipt, AuditCommentError, AuditGithub> {
  return Effect.gen(function* () {
    const github = yield* AuditGithub;
    const receipt = auditPull(input, promptDigest);
    const pullNumber = input.number ?? 0;
    yield* Effect.tryPromise({
      try: () => github.comment(pullNumber, formatAuditComment(receipt)),
      catch: (cause) => new AuditCommentError({ pullNumber, cause }),
    });
    return receipt;
  });
}

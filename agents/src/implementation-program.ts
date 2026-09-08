import { Context, Data, Effect, Layer } from "effect";
import { validateImplementationFiles, verifyImplementationGrant } from "./implementation-submission";
import { productFilesOnBranch, type GithubPort } from "./orchestrate";

export class ImplementationSubmissionError extends Data.TaggedError("ImplementationSubmissionError")<{
  operation: "authorize" | "decode" | "validate" | "read" | "commit";
  message: string;
  cause?: unknown;
}> {}

export class ImplementationGithub extends Context.Service<ImplementationGithub, GithubPort>()("my-ax/agents/ImplementationGithub") {}
export const implementationGithubLayer = (github: GithubPort) => Layer.succeed(ImplementationGithub, github);

function attempt<A>(operation: ImplementationSubmissionError["operation"], run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new ImplementationSubmissionError({ operation, cause, message: cause instanceof Error ? cause.message : String(cause) }),
  });
}

export function acceptImplementationEffect(request: Request, secret: string) {
  return Effect.gen(function* () {
    const github = yield* ImplementationGithub;
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    const grant = yield* attempt("authorize", () => verifyImplementationGrant(secret, token));
    const body = yield* attempt("decode", () => request.json() as Promise<{ files?: unknown }>);
    const files = yield* Effect.try({
      try: () => validateImplementationFiles(body.files),
      catch: (cause) => new ImplementationSubmissionError({ operation: "validate", cause, message: cause instanceof Error ? cause.message : "invalid implementation files" }),
    });
    if (!github.listBranchFiles || !github.commitFiles) return yield* Effect.fail(new ImplementationSubmissionError({ operation: "commit", message: "implementation transport is unavailable" }));
    const existing = productFilesOnBranch(yield* attempt("read", () => github.listBranchFiles!(grant.submissionHead)));
    if (existing.length) return { status: 409, body: { accepted: false as const, error: "submission branch already has product files" } };
    const commit = yield* attempt("commit", () => github.commitFiles!(grant.submissionHead, { message: `fix: implement issue #${grant.issueNumber}`, files }));
    return { status: 200, body: { accepted: true as const, issue: grant.issueNumber, head: grant.submissionHead, commit: commit.sha, files: files.map((file) => file.path) } };
  });
}

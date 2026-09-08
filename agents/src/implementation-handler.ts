import { Effect } from "effect";
import { acceptImplementationEffect, implementationGithubLayer } from "./implementation-program";
import { liveGithubPort } from "./ports";
import type { AgentsEnv } from "./workflows";

export async function acceptImplementationSubmission(request: Request, env: AgentsEnv): Promise<Response> {
  return Effect.runPromise(acceptImplementationEffect(request, env.GITHUB_WEBHOOK_SECRET || "").pipe(
    Effect.provide(implementationGithubLayer(liveGithubPort(env))),
    Effect.map(({ status, body }) => {
      if (body.accepted) console.log("implementation_submission_accepted", body);
      return Response.json(body, { status });
    }),
    Effect.catch((error) => {
      console.warn("implementation_submission_rejected", { operation: error.operation, error: error.message });
      return Effect.succeed(Response.json({ accepted: false, error: error.message }, { status: 400 }));
    }),
  ));
}

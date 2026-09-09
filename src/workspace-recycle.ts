import { Data, Effect } from "effect";

export class WorkspaceRecycleError extends Data.TaggedError("WorkspaceRecycleError")<{
  operation: "snapshot" | "destroy";
  cause: unknown;
  message: string;
}> {}

export function persistBeforeWorkspaceDestroy(
  snapshot: () => Promise<unknown>,
  destroy: () => Promise<void>,
): Effect.Effect<void, WorkspaceRecycleError> {
  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: snapshot,
      catch: (cause) => new WorkspaceRecycleError({ operation: "snapshot", cause, message: "workspace snapshot failed; container retained" }),
    });
    yield* Effect.tryPromise({
      try: destroy,
      catch: (cause) => new WorkspaceRecycleError({ operation: "destroy", cause, message: "workspace destroy failed after snapshot publication" }),
    });
  });
}

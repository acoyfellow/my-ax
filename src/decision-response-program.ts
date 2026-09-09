import { Clock, Context, Data, Effect, Layer, Result } from "effect";
import type { DecisionResponseStore } from "./decision-response";
import { IdGenerator, idGeneratorLive } from "./effect/id-generator";

export class DecisionOperationError extends Data.TaggedError("DecisionOperationError")<{
  operation: "insert_event" | "complete_run" | "reopen_run" | "delete_event" | "resume";
  reason: string;
  cause: unknown;
}> {
  override get message(): string {
    return this.reason;
  }
}

export class DecisionStore extends Context.Service<DecisionStore, DecisionResponseStore>()("my-ax/effect/DecisionStore") {}
export class DecisionResume extends Context.Service<DecisionResume, {
  readonly resume: Effect.Effect<void, DecisionOperationError>;
}>()("my-ax/effect/DecisionResume") {}

export function decisionResponseLayer(store: DecisionResponseStore, resume: () => Promise<void>) {
  return Layer.mergeAll(
    Layer.succeed(DecisionStore, DecisionStore.of(store)),
    Layer.succeed(DecisionResume, DecisionResume.of({ resume: attempt("resume", resume) })),
  );
}

export function decisionResponseLiveLayer(store: DecisionResponseStore, resume: () => Promise<void>) {
  return Layer.mergeAll(decisionResponseLayer(store, resume), idGeneratorLive);
}

function attempt<A>(
  operation: DecisionOperationError["operation"],
  run: () => Promise<A>,
): Effect.Effect<A, DecisionOperationError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new DecisionOperationError({
      operation,
      reason: cause instanceof Error ? cause.message : String(cause),
      cause,
    }),
  });
}

export function recordDecisionResponse(
  input: { id: string; email: string; question: string; choice: string; now?: string },
): Effect.Effect<boolean, DecisionOperationError, DecisionStore | DecisionResume | IdGenerator> {
  return Effect.gen(function* () {
    const store = yield* DecisionStore;
    const resume = yield* DecisionResume;
    const ids = yield* IdGenerator;
    const now = input.now ?? new Date(yield* Clock.currentTimeMillis).toISOString();
    const eventId = `evt-${yield* ids.next}`;
    const eventInput = { ...input, eventId, now };
    yield* attempt("insert_event", () => store.insertEvent(eventInput));

    const completion = yield* attempt("complete_run", () => store.completeRun(input)).pipe(Effect.result);
    if (Result.isFailure(completion)) {
      yield* attempt("delete_event", () => store.deleteEvent(eventInput)).pipe(Effect.catch(() => Effect.void));
      return yield* Effect.fail(completion.failure);
    }
    if (!completion.success) {
      yield* attempt("delete_event", () => store.deleteEvent(eventInput));
      return false;
    }

    const resumed = yield* resume.resume.pipe(Effect.result);
    if (Result.isSuccess(resumed)) return true;
    const reopened = yield* attempt("reopen_run", () => store.reopenRun(input)).pipe(
      Effect.catch(() => Effect.succeed(false)),
    );
    if (!reopened) {
      return yield* Effect.fail(new DecisionOperationError({
        operation: "reopen_run",
        reason: "Failed to reopen decision after resume error",
        cause: resumed.failure,
      }));
    }
    yield* attempt("delete_event", () => store.deleteEvent(eventInput));
    return yield* Effect.fail(resumed.failure);
  });
}

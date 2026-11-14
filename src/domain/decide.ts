import * as DateTime from "effect/DateTime";

type Prediction = { _tag: "Accepted"; events: ReadonlyArray<{ readonly _tag: string }> } | { _tag: "Rejected"; rejection: { readonly _tag: string } } | { _tag: "Unpredictable"; cause: unknown };

type Predicts = { predict(state: unknown, command: { readonly _tag: string }, options: { id: string; now: DateTime.Utc }): unknown };

export class DomainRejected extends Error {
  constructor(readonly rejection: { readonly _tag: string }) {
    super(rejection._tag);
  }
}

export function decide(aggregate: Predicts, id: string, state: unknown, command: { readonly _tag: string }): ReadonlyArray<{ readonly _tag: string }> {
  const prediction = aggregate.predict(state, command, { id, now: DateTime.nowUnsafe() }) as Prediction;
  if (prediction._tag === "Accepted") return prediction.events;
  if (prediction._tag === "Rejected") throw new DomainRejected(prediction.rejection);
  throw new Error(`domain could not decide ${command._tag}`);
}

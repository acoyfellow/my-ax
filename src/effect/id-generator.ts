import { Context, Effect, Layer } from "effect";

export class IdGenerator extends Context.Service<IdGenerator, {
  readonly next: Effect.Effect<string>;
}>()("my-ax/effect/IdGenerator") {}

export const idGeneratorLive = Layer.succeed(IdGenerator, IdGenerator.of({
  next: Effect.sync(() => crypto.randomUUID()),
}));

export function idGeneratorFixed(value: string): Layer.Layer<IdGenerator> {
  return Layer.succeed(IdGenerator, IdGenerator.of({ next: Effect.succeed(value) }));
}

import { Data, Effect } from "effect";

export class ModelOutputError extends Data.TaggedError("ModelOutputError")<{
  raw: string;
  cause: unknown;
}> {}

export type ModelOutputRepair = (raw: string, error: string) => Promise<string>;

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

export function parseModelOutput<A>(raw: string, repair?: ModelOutputRepair, originalRaw = raw): Effect.Effect<A, ModelOutputError> {
  const parsed = Effect.try({
    try: () => JSON.parse(extractJson(raw)) as A,
    catch: (cause) => new ModelOutputError({ raw: originalRaw, cause }),
  });
  if (!repair) return parsed;
  return parsed.pipe(Effect.catchTag("ModelOutputError", (error) =>
    Effect.tryPromise({
      try: () => repair(error.raw, String(error.cause)),
      catch: (cause) => new ModelOutputError({ raw: error.raw, cause }),
    }).pipe(Effect.flatMap((repaired) => parseModelOutput<A>(repaired, undefined, error.raw))),
  ));
}

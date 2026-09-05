import { Context, Data, Effect, Layer } from "effect";

export interface DatabaseBinding {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T = unknown>(): Promise<{ results?: T[] }>;
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  operation: "all" | "first" | "run";
  cause: unknown;
}> {}

export class Database extends Context.Service<Database, {
  all<A>(sql: string, values?: readonly unknown[]): Effect.Effect<readonly A[], DatabaseError>;
  first<A>(sql: string, values?: readonly unknown[]): Effect.Effect<A | null, DatabaseError>;
  run(sql: string, values?: readonly unknown[]): Effect.Effect<unknown, DatabaseError>;
}>()("my-ax/effect/Database") {}

function attempt<A>(operation: DatabaseError["operation"], run: () => Promise<A>): Effect.Effect<A, DatabaseError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new DatabaseError({ operation, cause }),
  });
}

export function databaseLayer(binding: DatabaseBinding): Layer.Layer<Database> {
  return Layer.succeed(Database, Database.of({
    all: <A>(sql: string, values: readonly unknown[] = []) => attempt("all", async () => {
      const result = await binding.prepare(sql).bind(...values).all<A>();
      return result.results ?? [];
    }),
    first: <A>(sql: string, values: readonly unknown[] = []) => attempt("first", () => binding.prepare(sql).bind(...values).first<A>()),
    run: (sql: string, values: readonly unknown[] = []) => attempt("run", () => binding.prepare(sql).bind(...values).run()),
  }));
}

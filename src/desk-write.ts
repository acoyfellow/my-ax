import { Data, Effect } from "effect";

export const DESK_WRITE_MAX_ATTEMPTS = 5;

export class DeskWriteConflict extends Error {
  constructor() {
    super("desk_write_conflict");
    this.name = "DeskWriteConflict";
  }
}

export interface VersionedRead<T> {
  value: T;
  version: string | null;
}

export interface DeskWriteIo<T> {
  read: () => Promise<VersionedRead<T>>;
  compareAndSet: (next: T, expectedVersion: string | null) => Promise<boolean>;
}

export class DeskWriteIoError extends Data.TaggedError("DeskWriteIoError")<{
  operation: "read" | "compare_and_set";
  cause: unknown;
}> {}

export function writeWithCompareAndSet<T>(
  io: DeskWriteIo<T>,
  apply: (current: T) => T,
  maxAttempts = DESK_WRITE_MAX_ATTEMPTS,
): Effect.Effect<{ value: T; attempts: number }, DeskWriteConflict | DeskWriteIoError> {
  return Effect.gen(function* () {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const current = yield* Effect.tryPromise({
        try: () => io.read(),
        catch: (cause) => new DeskWriteIoError({ operation: "read", cause }),
      });
      const next = apply(current.value);
      const written = yield* Effect.tryPromise({
        try: () => io.compareAndSet(next, current.version),
        catch: (cause) => new DeskWriteIoError({ operation: "compare_and_set", cause }),
      });
      if (written) return { value: next, attempts: attempt };
    }
    return yield* Effect.fail(new DeskWriteConflict());
  });
}

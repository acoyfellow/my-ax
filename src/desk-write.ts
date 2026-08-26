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

export async function writeWithCompareAndSet<T>(
  io: DeskWriteIo<T>,
  apply: (current: T) => T,
  maxAttempts = DESK_WRITE_MAX_ATTEMPTS,
): Promise<{ value: T; attempts: number }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const current = await io.read();
    const next = apply(current.value);
    if (await io.compareAndSet(next, current.version)) return { value: next, attempts: attempt };
  }
  throw new DeskWriteConflict();
}

export const COMPUTER_OWNER_MAX_RETAINED_WRITE_BYTES = 8 * 1024 * 1024;
export const COMPUTER_RETAINED_WRITE_RESERVATION_BYTES = 32 * 1024;

const COMPUTER_RETAINED_WRITE_BYTES_KEY = "computer:retained-write-bytes:v1";

type ComputerRetainedWriteTransaction = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
};

export type ComputerRetainedWriteStorage = {
  transaction<T>(closure: (transaction: ComputerRetainedWriteTransaction) => Promise<T>): Promise<T>;
};

function retainedWriteBytes(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > COMPUTER_OWNER_MAX_RETAINED_WRITE_BYTES) {
    throw new Error("Computer retained write budget state is invalid.");
  }
  return value;
}

export async function reserveComputerRetainedWriteBytes(storage: ComputerRetainedWriteStorage, contentBytes: number): Promise<number> {
  if (!Number.isSafeInteger(contentBytes) || contentBytes < 0 || contentBytes > COMPUTER_OWNER_MAX_RETAINED_WRITE_BYTES) {
    throw new Error("Computer retained write reservation is invalid.");
  }
  return storage.transaction(async (transaction) => {
    const usedBytes = retainedWriteBytes(await transaction.get<number>(COMPUTER_RETAINED_WRITE_BYTES_KEY));
    if (contentBytes > COMPUTER_OWNER_MAX_RETAINED_WRITE_BYTES - usedBytes) {
      throw new Error(`Computer owner retained write budget exceeded (${COMPUTER_OWNER_MAX_RETAINED_WRITE_BYTES} bytes).`);
    }
    const nextBytes = usedBytes + contentBytes;
    await transaction.put(COMPUTER_RETAINED_WRITE_BYTES_KEY, nextBytes);
    return nextBytes;
  });
}

export async function withReservedComputerRetainedWrite<T>(
  storage: ComputerRetainedWriteStorage,
  contentBytes: number,
  operation: () => Promise<T>,
): Promise<T> {
  await reserveComputerRetainedWriteBytes(storage, contentBytes);
  return operation();
}

export async function getComputerRetainedWriteBytes(storage: Pick<ComputerRetainedWriteTransaction, "get">): Promise<number> {
  return retainedWriteBytes(await storage.get<number>(COMPUTER_RETAINED_WRITE_BYTES_KEY));
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPUTER_OWNER_MAX_RETAINED_WRITE_BYTES,
  COMPUTER_RETAINED_WRITE_RESERVATION_BYTES,
  getComputerRetainedWriteBytes,
  reserveComputerRetainedWriteBytes,
  withReservedComputerRetainedWrite,
  type ComputerRetainedWriteStorage,
} from "./computer-retained-write-budget";
import { COMPUTER_WRITE_MAX_BYTES } from "./computer-filesystem";

class MemoryRetainedWriteStorage implements ComputerRetainedWriteStorage {
  constructor(private readonly values = new Map<string, unknown>()) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async transaction<T>(closure: (transaction: MemoryRetainedWriteStorage) => Promise<T>): Promise<T> {
    return closure(this);
  }

  restart(): MemoryRetainedWriteStorage {
    return new MemoryRetainedWriteStorage(this.values);
  }
}

test("Computer retained write reservations reach the durable owner cap and reject another overwrite", async () => {
  const storage = new MemoryRetainedWriteStorage();
  const overwriteBytes = COMPUTER_RETAINED_WRITE_RESERVATION_BYTES;
  assert.equal(overwriteBytes, COMPUTER_WRITE_MAX_BYTES);
  const overwrites = COMPUTER_OWNER_MAX_RETAINED_WRITE_BYTES / overwriteBytes;

  for (let index = 0; index < overwrites; index += 1) {
    await reserveComputerRetainedWriteBytes(storage, overwriteBytes);
  }

  assert.equal(await getComputerRetainedWriteBytes(storage), COMPUTER_OWNER_MAX_RETAINED_WRITE_BYTES);
  await assert.rejects(
    () => reserveComputerRetainedWriteBytes(storage, 1),
    /retained write budget/,
  );
});

test("Computer retained write reservations remain charged after a failed package write", async () => {
  const storage = new MemoryRetainedWriteStorage();
  await assert.rejects(
    () => withReservedComputerRetainedWrite(storage, 17, async () => { throw new Error("package write failed"); }),
    /package write failed/,
  );
  assert.equal(await getComputerRetainedWriteBytes(storage), 17);
});

test("Computer retained write reservations survive a storage restart", async () => {
  const storage = new MemoryRetainedWriteStorage();
  await reserveComputerRetainedWriteBytes(storage, 37);
  const restarted = storage.restart();

  assert.equal(await getComputerRetainedWriteBytes(restarted), 37);
  await reserveComputerRetainedWriteBytes(restarted, 5);
  assert.equal(await getComputerRetainedWriteBytes(storage), 42);
});

import {
  COMPUTER_GREP_MAX_TOTAL_BYTES,
  COMPUTER_READ_MAX_BYTES,
  COMPUTER_WRITE_MAX_BYTES,
} from "./computer-filesystem";

export const COMPUTER_WORK_CODE_MAX_CALLS = 16;
export const COMPUTER_WORK_CODE_MAX_CONCURRENCY = 4;
export const COMPUTER_WORK_CODE_MAX_CUMULATIVE_READ_BYTES = 256 * 1024;
export const COMPUTER_WORK_CODE_MAX_CUMULATIVE_WRITE_BYTES = 128 * 1024;

type ComputerFunction = (input: unknown) => Promise<unknown>;
type ComputerFunctions = Record<string, ComputerFunction>;

type ComputerReservation = {
  readBytes: number;
  writeBytes: number;
};

const encoder = new TextEncoder();

function byteLengthForWrite(input: unknown): number {
  const content = (input as { content?: unknown } | null)?.content;
  if (typeof content !== "string") return COMPUTER_WRITE_MAX_BYTES;
  if (content.length > COMPUTER_WRITE_MAX_BYTES) return COMPUTER_WRITE_MAX_BYTES + 1;
  return encoder.encode(content).byteLength;
}

function reservationForComputerMethod(method: string, input: unknown): ComputerReservation {
  if (method === "read") return { readBytes: COMPUTER_READ_MAX_BYTES, writeBytes: 0 };
  if (method === "grep") return { readBytes: COMPUTER_GREP_MAX_TOTAL_BYTES, writeBytes: 0 };
  if (method === "write") return { readBytes: 0, writeBytes: byteLengthForWrite(input) };
  return { readBytes: 0, writeBytes: 0 };
}

export function applyComputerWorkBudget<T extends ComputerFunctions>(functions: T): { [K in keyof T]: ComputerFunction } {
  let calls = 0;
  let concurrent = 0;
  let reservedReadBytes = 0;
  let reservedWriteBytes = 0;

  return Object.fromEntries(Object.entries(functions).map(([method, invoke]) => [method, async (input: unknown) => {
    const reservation = reservationForComputerMethod(method, input);
    if (calls >= COMPUTER_WORK_CODE_MAX_CALLS) {
      throw new Error(`Computer work_code call budget exceeded (${COMPUTER_WORK_CODE_MAX_CALLS}).`);
    }
    if (concurrent >= COMPUTER_WORK_CODE_MAX_CONCURRENCY) {
      throw new Error(`Computer work_code concurrency budget exceeded (${COMPUTER_WORK_CODE_MAX_CONCURRENCY}).`);
    }
    if (reservedReadBytes + reservation.readBytes > COMPUTER_WORK_CODE_MAX_CUMULATIVE_READ_BYTES) {
      throw new Error(`Computer work_code cumulative read budget exceeded (${COMPUTER_WORK_CODE_MAX_CUMULATIVE_READ_BYTES} bytes).`);
    }
    if (reservedWriteBytes + reservation.writeBytes > COMPUTER_WORK_CODE_MAX_CUMULATIVE_WRITE_BYTES) {
      throw new Error(`Computer work_code cumulative write budget exceeded (${COMPUTER_WORK_CODE_MAX_CUMULATIVE_WRITE_BYTES} bytes).`);
    }

    calls += 1;
    concurrent += 1;
    reservedReadBytes += reservation.readBytes;
    reservedWriteBytes += reservation.writeBytes;
    try {
      return await invoke(input);
    } finally {
      concurrent -= 1;
    }
  }])) as { [K in keyof T]: ComputerFunction };
}
